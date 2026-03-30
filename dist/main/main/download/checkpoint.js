"use strict";
// ============================================================================
// BiBox Downloader — Checkpoint Manager (Download Resume)
// ============================================================================
// [v2 NEW] JSON-based download state for crash-safe resume
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
exports.CheckpointManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("../logging/logger");
const STATE_FILENAME = '.download-state.json';
const STATE_VERSION = 1;
class CheckpointManager {
    state;
    filePath;
    saveTimer = null;
    dirty = false;
    // [PERF] Cached completed counts — avoids O(n) Object.values().filter() on every progress tick
    _completedPages = 0;
    _completedMaterials = 0;
    _countsDirty = true;
    constructor(bookDir, bookId) {
        this.filePath = path.join(bookDir, STATE_FILENAME);
        this.state = {
            bookId,
            version: STATE_VERSION,
            startedAt: new Date().toISOString(),
            status: 'pending',
            plan: { totalPages: 0, totalMaterials: 0, estimatedSizeMB: 0 },
            pages: {},
            materials: {},
            pdf: { status: 'pending' },
        };
    }
    // --- Load / Check existing ---
    static exists(bookDir) {
        return fs.existsSync(path.join(bookDir, STATE_FILENAME));
    }
    static load(bookDir, bookId) {
        const mgr = new CheckpointManager(bookDir, bookId);
        const filePath = path.join(bookDir, STATE_FILENAME);
        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const loaded = JSON.parse(raw);
                if (loaded.bookId === bookId && loaded.version === STATE_VERSION) {
                    mgr.state = loaded;
                    mgr._countsDirty = true; // Force recount from loaded state
                }
            }
            catch {
                // Corrupt checkpoint — start fresh
            }
        }
        return mgr;
    }
    // --- Plan ---
    setPlan(plan) {
        this.state.plan = plan;
        this.state.status = 'in_progress';
        this.markDirty();
    }
    // --- Pages ---
    initPages(filenames) {
        for (const f of filenames) {
            if (!this.state.pages[f]) {
                this.state.pages[f] = { status: 'pending' };
            }
        }
        this.markDirty();
    }
    setPageStatus(filename, status, extra) {
        this.state.pages[filename] = {
            ...this.state.pages[filename],
            status,
            ...extra,
        };
        this.markDirty();
    }
    getPageStatus(filename) {
        return this.state.pages[filename];
    }
    getPendingPages() {
        return Object.entries(this.state.pages)
            .filter(([_, s]) => s.status === 'pending' || s.status === 'failed')
            .map(([f]) => f);
    }
    getCompletedPageCount() {
        this.recalcCounts();
        return this._completedPages;
    }
    // --- Materials ---
    initMaterials(materialIds) {
        for (const id of materialIds) {
            const key = String(id);
            if (!this.state.materials[key]) {
                this.state.materials[key] = { status: 'pending' };
            }
        }
        this.markDirty();
    }
    setMaterialStatus(materialId, status, extra) {
        this.state.materials[String(materialId)] = {
            ...this.state.materials[String(materialId)],
            status,
            ...extra,
        };
        this.markDirty();
    }
    getMaterialStatus(materialId) {
        return this.state.materials[String(materialId)];
    }
    getPendingMaterials() {
        return Object.entries(this.state.materials)
            .filter(([_, s]) => s.status === 'pending' || s.status === 'failed')
            .map(([id]) => Number(id));
    }
    getCompletedMaterialCount() {
        this.recalcCounts();
        return this._completedMaterials;
    }
    // --- PDF ---
    setPdfStatus(status) {
        this.state.pdf.status = status;
        this.markDirty();
    }
    // --- Overall ---
    setStatus(status) {
        this.state.status = status;
        this.markDirty();
    }
    getState() {
        return this.state;
    }
    // --- Validate existing files ---
    validateCompletedFiles(bookDir) {
        // Check all "completed" pages — verify file exists and size matches
        for (const [filename, state] of Object.entries(this.state.pages)) {
            if (state.status === 'completed') {
                const filePath = path.join(bookDir, 'Seiten', filename);
                if (!fs.existsSync(filePath)) {
                    this.state.pages[filename] = { status: 'pending' };
                    continue;
                }
                if (state.size) {
                    const stat = fs.statSync(filePath);
                    if (stat.size !== state.size) {
                        this.state.pages[filename] = { status: 'pending' };
                    }
                }
            }
            // Reset in_progress items (may be corrupt from crash)
            if (state.status === 'in_progress') {
                this.state.pages[filename] = { status: 'pending' };
                // Clean up any .tmp files
                const tmpPath = path.join(bookDir, 'Seiten', filename + '.tmp');
                if (fs.existsSync(tmpPath)) {
                    try {
                        fs.unlinkSync(tmpPath);
                    }
                    catch { /* ignore */ }
                }
            }
        }
        // Same for materials
        for (const [matId, state] of Object.entries(this.state.materials)) {
            if (state.status === 'in_progress') {
                this.state.materials[matId] = { ...state, status: 'pending' };
            }
        }
        this.markDirty();
    }
    // --- Persistence ---
    invalidateCounts() {
        this._countsDirty = true;
    }
    recalcCounts() {
        if (!this._countsDirty)
            return;
        this._completedPages = 0;
        this._completedMaterials = 0;
        for (const s of Object.values(this.state.pages)) {
            if (s.status === 'completed')
                this._completedPages++;
        }
        for (const s of Object.values(this.state.materials)) {
            if (s.status === 'completed')
                this._completedMaterials++;
        }
        this._countsDirty = false;
    }
    markDirty() {
        this.dirty = true;
        this.invalidateCounts();
        this.scheduleSave();
    }
    scheduleSave() {
        if (this.saveTimer)
            return;
        this.saveTimer = setTimeout(() => {
            this.saveNow();
            this.saveTimer = null;
        }, 1000); // Debounce 1s
    }
    saveNow() {
        if (!this.dirty)
            return;
        try {
            const tmpPath = this.filePath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf-8');
            fs.renameSync(tmpPath, this.filePath);
            this.dirty = false;
        }
        catch (err) {
            logger_1.logger.error('Checkpoint', 'Save failed', err);
        }
    }
    dispose() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        this.saveNow();
    }
    delete() {
        this.dispose();
        try {
            if (fs.existsSync(this.filePath)) {
                fs.unlinkSync(this.filePath);
            }
        }
        catch { /* ignore */ }
    }
}
exports.CheckpointManager = CheckpointManager;
//# sourceMappingURL=checkpoint.js.map