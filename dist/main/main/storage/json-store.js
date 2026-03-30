"use strict";
// ============================================================================
// BiBox Downloader — JSON File Persistence
// ============================================================================
// [v2] Uses JSON files instead of SQLite for portability
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
exports.JsonStore = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("../logging/logger");
class JsonStore {
    filePath;
    data;
    dirty = false;
    constructor(filePath, defaultValue) {
        this.filePath = filePath;
        this.data = defaultValue;
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        // Load existing data
        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                this.data = JSON.parse(raw);
            }
            catch {
                // Corrupt file — use default
                this.data = defaultValue;
            }
        }
    }
    get() {
        return this.data;
    }
    set(data) {
        this.data = data;
        this.dirty = true;
        this.save();
    }
    update(updater) {
        this.data = updater(this.data);
        this.dirty = true;
        this.save();
    }
    save() {
        if (!this.dirty)
            return;
        try {
            const tmpPath = this.filePath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
            fs.renameSync(tmpPath, this.filePath);
            this.dirty = false;
        }
        catch (err) {
            logger_1.logger.error('JsonStore', `Save failed for ${this.filePath}`, err);
        }
    }
    delete() {
        try {
            if (fs.existsSync(this.filePath)) {
                fs.unlinkSync(this.filePath);
            }
        }
        catch { /* ignore */ }
    }
}
exports.JsonStore = JsonStore;
//# sourceMappingURL=json-store.js.map