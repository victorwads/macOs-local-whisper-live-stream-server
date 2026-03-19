interface PythonInstalledInfoEntry {
  size_mb?: number;
  size_bytes?: number;
}

export interface PythonModelsResponse {
  installed?: string[];
  installed_info?: Record<string, PythonInstalledInfoEntry>;
  supported?: string[];
  default?: string;
}

export interface PythonModelsCacheSizeResponse {
  size_bytes?: number;
}

interface JsonRequestOptions {
  method?: "GET" | "POST";
}

export class PythonHttpClient {
  private readonly baseHeaders = { Accept: "application/json" };

  public constructor(
    private readonly baseUrl = import.meta.env.VITE_PYTHON_BACKEND_HTTP_URL ?? "http://localhost:8000"
  ) {}

  public async getHealth(): Promise<boolean> {
    try {
      const response = await fetch(this.makeUrl("/health"), {
        method: "GET",
        headers: this.baseHeaders
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  public async getModels(): Promise<PythonModelsResponse | null> {
    return await this.requestJson<PythonModelsResponse>("/models", {
      context: "models list"
    });
  }

  public async getModelsCacheSize(): Promise<PythonModelsCacheSizeResponse | null> {
    return await this.requestJson<PythonModelsCacheSizeResponse>("/models/cache/size", {
      context: "models cache size"
    });
  }

  public async clearModelsCache(): Promise<boolean> {
    return await this.requestNoContent("/models/cache/clear", {
      method: "POST",
      context: "clear models cache"
    });
  }

  private async requestJson<T>(path: string, options: JsonRequestOptions & { context: string }): Promise<T | null> {
    try {
      const response = await fetch(this.makeUrl(path), {
        method: options.method ?? "GET",
        headers: this.baseHeaders
      });

      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      console.error(`Python backend ${options.context} request failed:`, error);
      return null;
    }
  }

  private async requestNoContent(path: string, options: JsonRequestOptions & { context: string }): Promise<boolean> {
    try {
      const response = await fetch(this.makeUrl(path), {
        method: options.method ?? "GET",
        headers: this.baseHeaders
      });

      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }

      return true;
    } catch (error) {
      console.error(`Python backend ${options.context} request failed:`, error);
      return false;
    }
  }

  private makeUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }
}
