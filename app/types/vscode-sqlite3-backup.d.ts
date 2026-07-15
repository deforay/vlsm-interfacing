import '@vscode/sqlite3';

declare module '@vscode/sqlite3' {
  /** Runtime backup handle exposed by the driver but omitted from its typings. */
  export interface Backup {
    readonly idle: boolean;
    readonly completed: boolean;
    readonly failed: boolean;
    readonly remaining: number;
    readonly pageCount: number;
    retryErrors: number[];

    step(pages: number, callback?: (err: Error | null, completed?: boolean) => void): this;
    finish(callback?: () => void): this;
  }

  interface Database {
    backup(filename: string, callback?: (err: Error | null) => void): Backup;
    backup(
      filename: string,
      destinationName: string,
      sourceName: string,
      filenameIsDestination: boolean,
      callback?: (err: Error | null) => void
    ): Backup;
  }
}
