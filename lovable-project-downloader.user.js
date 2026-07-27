// ==UserScript==
// @name         Lovable Project Downloader
// @namespace    https://tampermonkey.net/
// @version      3.0.0
// @description  Exporta o projeto completo do Lovable em ZIP usando a API Git da própria sessão, com retries, validação e suporte seguro a binários.
// @author       Coelhobugado
// @match        https://lovable.dev/*
// @match        https://*.lovable.dev/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=lovable.dev
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '3.0.0';
    const API_ORIGIN = 'https://api.lovable.dev';
    const MAX_CONCURRENCY = 5;
    const MAX_RETRIES = 3;
    const REQUEST_TIMEOUT_MS = 45_000;
    const AUTH_WAIT_MS = 2_000;
    const MAX_ZIP32_SIZE = 0xFFFFFFFF;
    const MAX_ZIP32_FILES = 0xFFFF;

    const state = {
        authHeader: '',
        refsByProject: new Map(),
        exporting: false,
        controller: null,
        routeTimer: 0,
        ui: null,
    };

    const nativeFetch = window.fetch.bind(window);
    const xhrOpen = XMLHttpRequest.prototype.open;
    const xhrSend = XMLHttpRequest.prototype.send;
    const xhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    const XHR_META = Symbol('lovableDownloaderXhrMeta');

    const crcTable = buildCrc32Table();

    installNetworkCapture();
    installRouteWatcher();
    onDomReady(ensureUi);

    console.info(`[Lovable Downloader v${VERSION}] ativo.`);

    function installNetworkCapture() {
        window.fetch = function lovableDownloaderFetch(input, init) {
            try {
                const url = getRequestUrl(input);
                const headers = mergeRequestHeaders(input, init);
                captureApiContext(url, headers);
            } catch (error) {
                console.debug('[Lovable Downloader] Não foi possível inspecionar uma chamada fetch.', error);
            }
            return nativeFetch(input, init);
        };

        XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
            this[XHR_META] = {
                method: String(method || 'GET').toUpperCase(),
                url: String(url || ''),
                headers: new Headers(),
            };
            return xhrOpen.call(this, method, url, ...rest);
        };

        XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
            try {
                this[XHR_META]?.headers.set(name, value);
            } catch (_) {}
            return xhrSetRequestHeader.call(this, name, value);
        };

        XMLHttpRequest.prototype.send = function patchedSend(...args) {
            try {
                const meta = this[XHR_META];
                if (meta) captureApiContext(meta.url, meta.headers);
            } catch (error) {
                console.debug('[Lovable Downloader] Não foi possível inspecionar uma chamada XHR.', error);
            }
            return xhrSend.apply(this, args);
        };
    }

    function getRequestUrl(input) {
        if (typeof input === 'string' || input instanceof URL) return String(input);
        if (input && typeof input.url === 'string') return input.url;
        return '';
    }

    function mergeRequestHeaders(input, init) {
        const headers = new Headers();
        if (input instanceof Request) input.headers.forEach((value, key) => headers.set(key, value));
        if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
        return headers;
    }

    function captureApiContext(rawUrl, headers) {
        if (!rawUrl) return;
        const url = new URL(rawUrl, location.href);
        if (url.origin !== API_ORIGIN) return;
        const auth = headers?.get?.('authorization');
        if (auth && /^Bearer\s+\S+/i.test(auth)) state.authHeader = auth;
        const projectId = extractProjectId(url.pathname);
        const ref = url.searchParams.get('ref');
        if (projectId && isCommitSha(ref)) state.refsByProject.set(projectId, ref);
    }

    function installRouteWatcher() {
        const notify = () => window.dispatchEvent(new Event('lovable-downloader:route-change'));
        for (const method of ['pushState', 'replaceState']) {
            const original = history[method];
            history[method] = function patchedHistory(...args) {
                const result = original.apply(this, args);
                notify();
                return result;
            };
        }
        window.addEventListener('popstate', notify);
        window.addEventListener('lovable-downloader:route-change', scheduleUiRefresh);
        onDomReady(() => {
            const observer = new MutationObserver(scheduleUiRefresh);
            observer.observe(document.documentElement, { childList: true, subtree: true });
            scheduleUiRefresh();
        });
    }

    function scheduleUiRefresh() {
        clearTimeout(state.routeTimer);
        state.routeTimer = window.setTimeout(ensureUi, 150);
    }

    function onDomReady(callback) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
        else callback();
    }

    function ensureUi() {
        if (!document.body) return;
        if (!state.ui || !state.ui.root.isConnected) {
            state.ui = createUi();
            document.body.appendChild(state.ui.root);
        }
        const projectId = getCurrentProjectId();
        state.ui.root.hidden = !projectId;
        if (!state.exporting) setStatus(projectId ? 'Pronto para exportar' : 'Abra um projeto do Lovable', 0);
    }

    function createUi() {
        const root = document.createElement('section');
        root.id = 'lovable-downloader';
        root.hidden = true;
        root.setAttribute('aria-label', 'Exportador de projeto Lovable');
        root.innerHTML = `
            <style>
                #lovable-downloader { all: initial; position: fixed; right: 22px; bottom: 22px; z-index: 2147483647; width: min(360px, calc(100vw - 28px)); box-sizing: border-box; padding: 12px; border: 1px solid rgba(255,255,255,.14); border-radius: 16px; background: rgba(20,18,29,.94); color: #fff; box-shadow: 0 14px 44px rgba(0,0,0,.38); backdrop-filter: blur(14px); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
                #lovable-downloader[hidden] { display: none !important; }
                #lovable-downloader * { box-sizing: border-box; }
                #lovable-downloader .ld-head { display: flex; align-items: center; gap: 10px; }
                #lovable-downloader .ld-main { appearance: none; flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 11px 14px; border: 0; border-radius: 11px; background: linear-gradient(135deg,#7c3aed 0%,#db2777 100%); color: #fff; cursor: pointer; font: 700 13px/1.2 inherit; box-shadow: 0 8px 22px rgba(124,58,237,.32); transition: transform .16s ease, filter .16s ease, opacity .16s ease; }
                #lovable-downloader .ld-main:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.08); }
                #lovable-downloader .ld-main:disabled { cursor: wait; opacity: .72; }
                #lovable-downloader .ld-cancel { appearance: none; display: none; width: 38px; height: 38px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; background: rgba(255,255,255,.08); color: #fff; cursor: pointer; font: 700 17px/1 inherit; }
                #lovable-downloader .ld-status { margin-top: 9px; overflow: hidden; color: rgba(255,255,255,.78); font: 500 11px/1.35 inherit; text-overflow: ellipsis; white-space: nowrap; }
                #lovable-downloader .ld-track { height: 4px; margin-top: 8px; overflow: hidden; border-radius: 99px; background: rgba(255,255,255,.11); }
                #lovable-downloader .ld-progress { width: 0; height: 100%; border-radius: inherit; background: linear-gradient(90deg,#a78bfa,#f472b6); transition: width .18s ease; }
                @media (max-width:520px) { #lovable-downloader { right: 14px; bottom: 14px; width: calc(100vw - 28px); } }
            </style>
            <div class="ld-head">
                <button class="ld-main" type="button" title="Baixar uma cópia ZIP do projeto atual"><span>Baixar projeto completo</span></button>
                <button class="ld-cancel" type="button" title="Cancelar exportação" aria-label="Cancelar exportação">×</button>
            </div>
            <div class="ld-status" role="status" aria-live="polite">Pronto para exportar</div>
            <div class="ld-track" aria-hidden="true"><div class="ld-progress"></div></div>`;
        const button = root.querySelector('.ld-main');
        const cancel = root.querySelector('.ld-cancel');
        const status = root.querySelector('.ld-status');
        const progress = root.querySelector('.ld-progress');
        button.addEventListener('click', downloadCurrentProject);
        cancel.addEventListener('click', () => state.controller?.abort(new DOMException('Cancelado pelo usuário.', 'AbortError')));
        return { root, button, cancel, status, progress };
    }

    async function downloadCurrentProject() {
        if (state.exporting) return;
        const projectId = getCurrentProjectId();
        if (!projectId) return showError('Não foi possível identificar o projeto na URL atual.');
        state.exporting = true;
        state.controller = new AbortController();
        setBusy(true);
        try {
            setStatus('Preparando autenticação…', 2);
            await ensureAuthAvailable(projectId, state.controller.signal);
            setStatus('Localizando o estado atual do projeto…', 5);
            const ref = await resolveLatestRef(projectId, state.controller.signal);
            if (ref) state.refsByProject.set(projectId, ref);
            setStatus('Obtendo a lista de arquivos…', 8);
            const files = await getFileTree(projectId, ref, state.controller.signal);
            validateFileList(files);
            const total = files.length;
            const results = new Array(total);
            const failures = [];
            let completed = 0;
            let downloadedBytes = 0;
            await runWorkerPool(files, MAX_CONCURRENCY, async (file, index) => {
                try {
                    const data = await downloadFile(projectId, ref, file, state.controller.signal);
                    results[index] = { path: normalizeZipPath(file.path), data };
                    downloadedBytes += data.byteLength;
                } catch (error) {
                    failures.push({ path: file.path, error: readableError(error) });
                } finally {
                    completed += 1;
                    const percent = 8 + Math.round((completed / total) * 72);
                    setStatus(`Baixando ${completed}/${total} • ${formatBytes(downloadedBytes)} • ${file.path}`, percent);
                }
            }, state.controller.signal);
            if (failures.length) {
                const preview = failures.slice(0, 8).map(item => `• ${item.path}: ${item.error}`).join('\n');
                throw new Error(`${failures.length} arquivo(s) não puderam ser baixados.\n\n${preview}`);
            }
            const completeFiles = results.filter(Boolean);
            if (completeFiles.length !== total) throw new Error(`Validação falhou: esperados ${total} arquivos, recebidos ${completeFiles.length}.`);
            setStatus(`Compactando ${total} arquivos…`, 86);
            const zip = new ZipBuilder();
            for (let index = 0; index < completeFiles.length; index += 1) {
                throwIfAborted(state.controller.signal);
                const file = completeFiles[index];
                await zip.add(file.path, file.data);
                setStatus(`Compactando ${index + 1}/${total} • ${file.path}`, 86 + Math.round(((index + 1) / total) * 12));
                if (index % 10 === 0) await yieldToBrowser();
            }
            const zipBytes = zip.finish();
            const displayName = inferProjectName(projectId);
            const snapshotName = ref ? ref.slice(0, 8) : 'current';
            const fileName = `${sanitizeFileName(displayName)}-${snapshotName}.zip`;
            setStatus(`Salvando ${formatBytes(zipBytes.byteLength)}…`, 99);
            triggerDownload(zipBytes, fileName);
            setStatus(`Concluído: ${total} arquivos • ${formatBytes(zipBytes.byteLength)}`, 100);
        } catch (error) {
            if (isAbortError(error)) setStatus('Exportação cancelada.', 0);
            else {
                console.error('[Lovable Downloader] Falha na exportação:', error);
                setStatus(`Erro: ${firstLine(readableError(error))}`, 0);
                showError(readableError(error));
            }
        } finally {
            state.exporting = false;
            state.controller = null;
            setBusy(false);
        }
    }

    async function ensureAuthAvailable(projectId, signal) {
        if (state.authHeader) return;
        state.authHeader = findAuthHeaderInStorage();
        if (state.authHeader) return;
        const startedAt = Date.now();
        while (!state.authHeader && Date.now() - startedAt < AUTH_WAIT_MS) {
            throwIfAborted(signal);
            await sleep(100, signal);
        }
        const probe = await fetchWithTimeout(`${API_ORIGIN}/projects/${projectId}/workspace`, { credentials: 'include', signal }, REQUEST_TIMEOUT_MS, signal);
        if (probe.ok) return;
        if (probe.status === 401 || probe.status === 403) throw new Error('A autenticação da sessão não foi capturada. Recarregue esta página do Lovable com o Tampermonkey ativo e tente novamente.');
        throw new Error(`Não foi possível validar a sessão do Lovable (HTTP ${probe.status}).`);
    }

    function findAuthHeaderInStorage() {
        const storages = [localStorage, sessionStorage];
        const likelyKey = /(auth|token|session|supabase|firebase)/i;
        for (const storage of storages) {
            for (let index = 0; index < storage.length; index += 1) {
                const key = storage.key(index) || '';
                if (!likelyKey.test(key)) continue;
                const raw = storage.getItem(key);
                if (!raw || raw.length > 2_000_000) continue;
                const token = extractAccessToken(raw);
                if (token) return `Bearer ${token}`;
            }
        }
        return '';
    }

    function extractAccessToken(raw) {
        const direct = raw.match(/(?:access_token|accessToken)["']?\s*[:=]\s*["']([^"']{20,})["']/i)?.[1];
        if (direct) return direct;
        try { return deepFindAccessToken(JSON.parse(raw), 0); } catch (_) { return ''; }
    }

    function deepFindAccessToken(value, depth) {
        if (!value || depth > 6) return '';
        if (Array.isArray(value)) {
            for (const item of value) { const token = deepFindAccessToken(item, depth + 1); if (token) return token; }
            return '';
        }
        if (typeof value !== 'object') return '';
        for (const [key, item] of Object.entries(value)) if (/^(access_token|accessToken)$/i.test(key) && typeof item === 'string' && item.length >= 20) return item;
        for (const item of Object.values(value)) { const token = deepFindAccessToken(item, depth + 1); if (token) return token; }
        return '';
    }

    async function resolveLatestRef(projectId, signal) {
        throwIfAborted(signal);
        const captured = state.refsByProject.get(projectId);
        return isCommitSha(captured) ? captured : '';
    }

    async function getFileTree(projectId, ref, signal) {
        const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
        const payload = await apiFetchJson(`/projects/${projectId}/git/files${query}`, { signal }, { retries: MAX_RETRIES });
        return Array.isArray(payload?.files) ? payload.files : [];
    }

    function validateFileList(files) {
        if (!files.length) throw new Error('A API retornou uma lista vazia de arquivos.');
        if (files.length > MAX_ZIP32_FILES) throw new Error(`O projeto contém ${files.length} arquivos e ultrapassa o limite ZIP32.`);
        const seen = new Set();
        for (const file of files) {
            if (!file || typeof file.path !== 'string' || !file.path.trim()) throw new Error('A API retornou uma entrada de arquivo inválida.');
            const normalized = normalizeZipPath(file.path);
            if (seen.has(normalized)) throw new Error(`A API retornou um caminho duplicado: ${normalized}`);
            seen.add(normalized);
        }
    }

    async function downloadFile(projectId, ref, file, signal) {
        const path = normalizeZipPath(file.path);
        const refQuery = ref ? `&ref=${encodeURIComponent(ref)}` : '';
        const response = await apiFetch(`/projects/${projectId}/git/file?path=${encodeURIComponent(path)}${refQuery}`, { signal }, { retries: MAX_RETRIES });
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (file.binary && contentType.includes('application/json')) {
            const decoded = new TextDecoder().decode(bytes);
            try {
                const json = JSON.parse(decoded);
                if (isWrappedFilePayload(json)) return decodeJsonFilePayload(json, path, signal);
            } catch (_) {}
        }
        if (file.binary && looksLikeBinaryPlaceholder(bytes)) throw new Error(`A API devolveu apenas um marcador de binário para ${path}.`);
        return bytes;
    }

    function isWrappedFilePayload(payload) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
        const encoded = typeof payload.encoding === 'string' && (typeof payload.content === 'string' || typeof payload.data === 'string');
        const remote = [payload.download_url, payload.downloadUrl, payload.signed_url, payload.signedUrl, payload.url].some(v => typeof v === 'string' && /^https?:\/\//i.test(v));
        return encoded || remote;
    }

    async function decodeJsonFilePayload(payload, path, signal) {
        if (typeof payload?.content === 'string') return /base64/i.test(payload.encoding || '') ? base64ToBytes(payload.content) : new TextEncoder().encode(payload.content);
        if (typeof payload?.data === 'string') return (/base64/i.test(payload.encoding || '') || looksLikeBase64(payload.data)) ? base64ToBytes(payload.data) : new TextEncoder().encode(payload.data);
        const remoteUrl = payload?.download_url || payload?.downloadUrl || payload?.signed_url || payload?.signedUrl || payload?.url;
        if (typeof remoteUrl === 'string' && /^https?:\/\//i.test(remoteUrl)) {
            const response = await fetchWithRetry(remoteUrl, { credentials: 'omit', signal }, MAX_RETRIES, signal);
            return new Uint8Array(await response.arrayBuffer());
        }
        throw new Error(`Formato de conteúdo não reconhecido para ${path}.`);
    }

    async function apiFetchJson(path, init, options) {
        const response = await apiFetch(path, init, options);
        const text = await response.text();
        try { return JSON.parse(text); } catch (_) { throw new Error(`A API retornou JSON inválido em ${path}.`); }
    }

    async function apiFetch(path, init = {}, { retries = MAX_RETRIES } = {}) {
        const url = path.startsWith('http') ? path : `${API_ORIGIN}${path}`;
        const headers = new Headers(init.headers || {});
        headers.set('Accept', headers.get('Accept') || '*/*');
        if (state.authHeader) headers.set('Authorization', state.authHeader);
        const response = await fetchWithRetry(url, { ...init, headers, credentials: 'include' }, retries, init.signal);
        if ((response.status === 401 || response.status === 403) && !state.authHeader) throw new Error('A sessão do Lovable não autorizou o acesso ao projeto.');
        return response;
    }

    async function fetchWithRetry(url, init, retries, signal) {
        let lastError;
        for (let attempt = 0; attempt <= retries; attempt += 1) {
            throwIfAborted(signal);
            try {
                const response = await fetchWithTimeout(url, init, REQUEST_TIMEOUT_MS, signal);
                if (response.ok) return response;
                const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
                if (!retryable || attempt === retries) {
                    const details = await safeResponseSnippet(response);
                    const error = new Error(`HTTP ${response.status}${details ? ` — ${details}` : ''}`);
                    error.nonRetryable = !retryable;
                    throw error;
                }
                await sleep(parseRetryAfter(response.headers.get('retry-after')) ?? backoffDelay(attempt), signal);
            } catch (error) {
                if (isAbortError(error) || error?.nonRetryable) throw error;
                lastError = error;
                if (attempt === retries) break;
                await sleep(backoffDelay(attempt), signal);
            }
        }
        throw lastError || new Error('Falha de rede desconhecida.');
    }

    async function fetchWithTimeout(url, init, timeoutMs, parentSignal) {
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(new DOMException('Tempo limite da requisição excedido.', 'TimeoutError')), timeoutMs);
        const signal = combineSignals(parentSignal, timeoutController.signal);
        try { return await nativeFetch(url, { ...init, signal }); } finally { clearTimeout(timeoutId); }
    }

    function combineSignals(...signals) {
        const active = signals.filter(Boolean);
        if (!active.length) return undefined;
        if (active.length === 1) return active[0];
        if (typeof AbortSignal.any === 'function') return AbortSignal.any(active);
        const controller = new AbortController();
        for (const signal of active) {
            if (signal.aborted) { controller.abort(signal.reason); break; }
            signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
        }
        return controller.signal;
    }

    async function runWorkerPool(items, concurrency, worker, signal) {
        let nextIndex = 0;
        const count = Math.max(1, Math.min(concurrency, items.length));
        await Promise.all(Array.from({ length: count }, async () => {
            while (true) {
                throwIfAborted(signal);
                const index = nextIndex++;
                if (index >= items.length) return;
                await worker(items[index], index);
            }
        }));
    }

    class ZipBuilder {
        constructor() { this.parts = []; this.centralDirectory = []; this.offset = 0; this.count = 0; this.date = new Date(); }
        async add(rawPath, input) {
            const path = normalizeZipPath(rawPath);
            const name = new TextEncoder().encode(path);
            const original = toUint8Array(input);
            if (original.byteLength > MAX_ZIP32_SIZE || this.offset > MAX_ZIP32_SIZE) throw new Error('Limite ZIP32 excedido.');
            const crc = crc32(original);
            const compressed = await compressForZip(original);
            const payload = compressed.data;
            const { dosTime, dosDate } = toDosDateTime(this.date);
            const flags = 0x0800;
            const localHeader = new Uint8Array(30 + name.length);
            const localView = new DataView(localHeader.buffer);
            localView.setUint32(0, 0x04034B50, true); localView.setUint16(4, 20, true); localView.setUint16(6, flags, true); localView.setUint16(8, compressed.method, true); localView.setUint16(10, dosTime, true); localView.setUint16(12, dosDate, true); localView.setUint32(14, crc, true); localView.setUint32(18, payload.length, true); localView.setUint32(22, original.length, true); localView.setUint16(26, name.length, true); localHeader.set(name, 30);
            const central = new Uint8Array(46 + name.length);
            const centralView = new DataView(central.buffer);
            centralView.setUint32(0, 0x02014B50, true); centralView.setUint16(4, 0x0314, true); centralView.setUint16(6, 20, true); centralView.setUint16(8, flags, true); centralView.setUint16(10, compressed.method, true); centralView.setUint16(12, dosTime, true); centralView.setUint16(14, dosDate, true); centralView.setUint32(16, crc, true); centralView.setUint32(20, payload.length, true); centralView.setUint32(24, original.length, true); centralView.setUint16(28, name.length, true); centralView.setUint32(38, 0x81A40000, true); centralView.setUint32(42, this.offset, true); central.set(name, 46);
            this.parts.push(localHeader, payload); this.centralDirectory.push(central); this.offset += localHeader.length + payload.length; this.count += 1;
        }
        finish() {
            const centralOffset = this.offset;
            let centralSize = 0;
            for (const entry of this.centralDirectory) { this.parts.push(entry); centralSize += entry.length; }
            const end = new Uint8Array(22);
            const view = new DataView(end.buffer);
            view.setUint32(0, 0x06054B50, true); view.setUint16(8, this.count, true); view.setUint16(10, this.count, true); view.setUint32(12, centralSize, true); view.setUint32(16, centralOffset, true);
            this.parts.push(end);
            const total = this.parts.reduce((sum, part) => sum + part.length, 0);
            if (total > MAX_ZIP32_SIZE) throw new Error('O arquivo final ultrapassa o limite ZIP32 de 4 GiB.');
            const result = new Uint8Array(total);
            let cursor = 0;
            for (const part of this.parts) { result.set(part, cursor); cursor += part.length; }
            return result;
        }
    }

    async function compressForZip(data) {
        if (data.length < 256 || typeof CompressionStream !== 'function') return { method: 0, data };
        try {
            const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
            const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
            if (compressed.length < data.length) return { method: 8, data: compressed };
        } catch (_) {}
        return { method: 0, data };
    }

    function triggerDownload(bytes, fileName) {
        const blob = new Blob([bytes], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = fileName; anchor.style.display = 'none'; document.body.appendChild(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    function getCurrentProjectId() { return extractProjectId(location.pathname); }
    function extractProjectId(pathname) { return pathname.match(/\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i)?.[1] || ''; }
    function isCommitSha(value) { return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value); }
    function normalizeZipPath(path) {
        const normalized = String(path).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
        if (!normalized || normalized.includes('\0')) throw new Error('Caminho de arquivo inválido recebido da API.');
        if (normalized.split('/').some(part => part === '..')) throw new Error(`Caminho inseguro bloqueado: ${normalized}`);
        return normalized;
    }
    function inferProjectName(projectId) {
        const title = document.title.replace(/\s*[|–—-]\s*Lovable.*$/i, '').replace(/^Lovable\s*[|–—-]\s*/i, '').trim();
        return title && !/^lovable$/i.test(title) ? title : `lovable-project-${projectId}`;
    }
    function sanitizeFileName(value) { return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[-. ]+|[-. ]+$/g, '').slice(0, 120) || 'lovable-project'; }
    function setBusy(busy) { if (!state.ui) return; state.ui.button.disabled = busy; state.ui.cancel.style.display = busy ? 'inline-grid' : 'none'; state.ui.cancel.style.placeItems = 'center'; state.ui.button.querySelector('span').textContent = busy ? 'Exportando projeto…' : 'Baixar projeto completo'; }
    function setStatus(message, percent) { if (!state.ui) return; state.ui.status.textContent = message; state.ui.status.title = message; state.ui.progress.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`; }
    function showError(message) { alert(`Lovable Project Downloader\n\n${message}`); }
    function toUint8Array(value) { if (value instanceof Uint8Array) return value; if (value instanceof ArrayBuffer) return new Uint8Array(value); if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength); if (typeof value === 'string') return new TextEncoder().encode(value); throw new TypeError('Conteúdo de arquivo não suportado.'); }
    function buildCrc32Table() { const table = new Uint32Array(256); for (let index = 0; index < 256; index += 1) { let value = index; for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1); table[index] = value >>> 0; } return table; }
    function crc32(bytes) { let crc = 0xFFFFFFFF; for (let index = 0; index < bytes.length; index += 1) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[index]) & 0xFF]; return (crc ^ 0xFFFFFFFF) >>> 0; }
    function toDosDateTime(date) { const year = Math.max(1980, date.getFullYear()); return { dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2), dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() }; }
    function base64ToBytes(base64) { const normalized = base64.replace(/^data:[^,]+,/, '').replace(/\s+/g, ''); const binary = atob(normalized); const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index); return bytes; }
    function looksLikeBase64(value) { const compact = String(value).replace(/\s+/g, ''); return compact.length >= 16 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact); }
    function looksLikeBinaryPlaceholder(bytes) { if (bytes.length > 64) return false; const text = new TextDecoder().decode(bytes).trim().toLowerCase(); return text === '<binary>' || text === 'binary' || text === '[binary]'; }
    function parseRetryAfter(value) { if (!value) return null; const seconds = Number(value); if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000); const date = Date.parse(value); return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null; }
    function backoffDelay(attempt) { return Math.min(8_000, 600 * (2 ** attempt) + Math.floor(Math.random() * 250)); }
    async function safeResponseSnippet(response) { try { return (await response.clone().text()).replace(/\s+/g, ' ').trim().slice(0, 180); } catch (_) { return ''; } }
    function formatBytes(bytes) { const value = Number(bytes) || 0; if (value < 1024) return `${value} B`; const units = ['KB', 'MB', 'GB']; let size = value / 1024; let unit = units[0]; for (let index = 1; index < units.length && size >= 1024; index += 1) { size /= 1024; unit = units[index]; } return `${size.toLocaleString('pt-BR', { maximumFractionDigits: size >= 100 ? 0 : 1 })} ${unit}`; }
    function sleep(ms, signal) { return new Promise((resolve, reject) => { const timer = setTimeout(resolve, ms); if (!signal) return; if (signal.aborted) { clearTimeout(timer); reject(signal.reason || new DOMException('Operação cancelada.', 'AbortError')); return; } signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason || new DOMException('Operação cancelada.', 'AbortError')); }, { once: true }); }); }
    function yieldToBrowser() { return new Promise(resolve => setTimeout(resolve, 0)); }
    function throwIfAborted(signal) { if (signal?.aborted) throw signal.reason || new DOMException('Operação cancelada.', 'AbortError'); }
    function isAbortError(error) { return error?.name === 'AbortError'; }
    function readableError(error) { return error instanceof Error ? (error.message || error.name) : String(error || 'Erro desconhecido.'); }
    function firstLine(value) { return String(value).split(/\r?\n/, 1)[0]; }
})();