"use strict";
// ============================================================================
// BiBox Downloader — JSON-based ETag Cache
// ============================================================================
// [v2] Uses JSON files instead of SQLite for portability (no native deps)
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.etagCache = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("../logging/logger");
class EtagCacheManager {
    cache = { entries: {} };
    filePath = null;
    dirty = false;
    saveTimer = null;
    initialize(cacheDir) {
        this.filePath = path.join(cacheDir, 'etags.json');
        // Ensure cache directory exists
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        // Load existing cache
        if (fs.existsSync(this.filePath)) {
            try {
                const raw = fs.readFileSync(this.filePath, 'utf-8');
                this.cache = JSON.parse(raw);
            }
            catch {
                // Corrupt cache file — start fresh
                this.cache = { entries: {} };
            }
        }
    }
    get(url) {
        return this.cache.entries[url] || null;
    }
    set(url, etag, data) {
        this.cache.entries[url] = {
            url,
            etag,
            data,
            cachedAt: Date.now(),
        };
        this.dirty = true;
        this.scheduleSave();
    }
    delete(url) {
        delete this.cache.entries[url];
        this.dirty = true;
        this.scheduleSave();
    }
    clear() {
        this.cache = { entries: {} };
        this.dirty = true;
        this.saveNow();
    }
    // Debounced save — batches multiple writes
    scheduleSave() {
        if (this.saveTimer)
            return;
        this.saveTimer = setTimeout(() => {
            this.saveNow();
            this.saveTimer = null;
        }, 2000);
    }
    saveNow() {
        if (!this.dirty || !this.filePath)
            return;
        try {
            // Atomic write: write to .tmp then rename
            const tmpPath = this.filePath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(this.cache, null, 2), 'utf-8');
            fs.renameSync(tmpPath, this.filePath);
            this.dirty = false;
        }
        catch (err) {
            logger_1.logger.error('ETagCache', 'Save failed', err);
        }
    }
    // Cleanup on app exit
    dispose() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        this.saveNow();
    }
}
exports.etagCache = new EtagCacheManager();
//# sourceMappingURL=etag-cache.js.map