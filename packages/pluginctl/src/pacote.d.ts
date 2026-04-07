declare module "pacote" {
  export interface PacoteManifest {
    name?: string;
    version?: string;
    _integrity?: string;
    _resolved?: string;
    dist?: {
      integrity?: string;
      tarball?: string;
    };
  }

  export interface PacoteModule {
    extract(spec: string, dest: string, opts?: Record<string, unknown>): Promise<void>;
    manifest(spec: string, opts?: Record<string, unknown>): Promise<PacoteManifest>;
  }

  const pacote: PacoteModule;
  export default pacote;
}
