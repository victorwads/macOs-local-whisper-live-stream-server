import type { BackendInterface } from "../backend-interface";
import type { BackendModelInfo, BackendId } from "../types";
import { chooseSizeBytes } from "../helpers/choose-size-bytes";

interface PythonInstalledInfoEntry {
  size_mb?: number;
  size_bytes?: number;
}

interface PythonModelsResponse {
  installed?: string[];
  installed_info?: Record<string, PythonInstalledInfoEntry>;
  supported?: string[];
}

const PYTHON_BACKEND_HTTP_BASE_URL = import.meta.env.VITE_PYTHON_BACKEND_HTTP_URL ?? "http://localhost:8000";
const PYTHON_BACKEND_MODELS_URL = `${PYTHON_BACKEND_HTTP_BASE_URL}/models`;
const PYTHON_BACKEND_MODELS_CACHE_SIZE_URL = `${PYTHON_BACKEND_HTTP_BASE_URL}/models/cache/size`;
const PYTHON_BACKEND_MODELS_CACHE_CLEAR_URL = `${PYTHON_BACKEND_HTTP_BASE_URL}/models/cache/clear`;

interface PythonModelsCacheSizeResponse {
  size_bytes?: number;
}

export class PythonBackend implements BackendInterface {
  public readonly id: BackendId = "python";

  public async getModelsList(): Promise<BackendModelInfo[]> {
    try {
      const response = await fetch(PYTHON_BACKEND_MODELS_URL, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(`Python backend models request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as PythonModelsResponse;
      const installed = new Set(payload.installed ?? []);
      const installedInfo = payload.installed_info ?? {};
      const supported = payload.supported ?? [];

      const uniqueModelNames = Array.from(new Set([...supported, ...installed])).sort();

      return uniqueModelNames.map((name) => ({
        name,
        installed: installed.has(name),
        sizeBytes: chooseSizeBytes(installedInfo[name])
      }));
    } catch (error) {
      console.error("Failed to fetch Python backend models list:", error);
      return [];
    }
  }

  public async clearDownloadedModelsCache(): Promise<void> {
    try {
      const response = await fetch(PYTHON_BACKEND_MODELS_CACHE_CLEAR_URL, {
        method: "POST",
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(`Python backend clear cache request failed with status ${response.status}`);
      }
    } catch (error) {
      console.error("Failed to clear Python backend models cache:", error);
    }
  }

  public async getDownloadedModelsCacheSizeBytes(): Promise<number> {
    try {
      const response = await fetch(PYTHON_BACKEND_MODELS_CACHE_SIZE_URL, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(`Python backend cache size request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as PythonModelsCacheSizeResponse;
      return Number.isFinite(payload?.size_bytes) ? Math.max(0, Math.round(Number(payload.size_bytes))) : 0;
    } catch (error) {
      console.error("Failed to get Python backend models cache size:", error);
      return 0;
    }
  }
}
