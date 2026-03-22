import { ErrorHandler, Injectable } from '@angular/core';
import { LoggingService } from './logging.service';

@Injectable()
export class GlobalErrorHandlerService implements ErrorHandler {
  constructor(private readonly loggingService: LoggingService) {}

  handleError(error: unknown): void {
    const formattedError = this.formatError(error);

    // WHY: Angular catches many runtime errors that never reach the existing
    // logging pipeline, so persist them explicitly for post-mortem debugging.
    this.loggingService.log('error', `[Renderer][Angular] ${formattedError}`);

    if (error instanceof Error && error.stack) {
      console.error(error.stack);
      return;
    }

    console.error(error);
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }

    if (typeof error === 'string') {
      return error;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
}
