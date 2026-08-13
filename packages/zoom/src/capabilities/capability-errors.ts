import { ZoomError, ZoomErrorCode } from '@zoom-assistant/shared';

export class CapabilityResolutionError extends ZoomError {
  constructor(reason: string) {
    super(
      ZoomErrorCode.NOT_ALLOWED,
      `Capability resolution failed: ${reason}`,
    );
    this.name = 'CapabilityResolutionError';
    Object.setPrototypeOf(this, CapabilityResolutionError.prototype);
  }
}
