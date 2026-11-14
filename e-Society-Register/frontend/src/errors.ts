const messages = {
  VALIDATION_ERROR: 'Check the submitted fields.',
  UNAUTHORIZED: 'Sign in to continue.',
  TOKEN_EXPIRED: 'Your session has expired. Sign in again.',
  FORBIDDEN: 'You do not have permission in this workspace.',
  NOT_FOUND: 'This record could not be found.',
  HOME_NOT_FOUND: 'Home not found. Check the wing and flat number.',
  OTP_INVALID: 'The code is incorrect or has expired.',
  OTP_RATE_LIMITED: 'Too many attempts. Wait before requesting or trying another code.',
  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  PHONE_ALREADY_USED: 'That phone number belongs to another account.',
  FLAT_ALREADY_EXISTS: 'This home is already registered.',
  ALREADY_MEMBER: 'You already belong here or have a pending request.',
  SOCIETY_NOT_APPROVED: 'This society is inactive. Contact the Platform Admin.',
  DUTY_ALREADY_STARTED: 'End your current duty before starting another.',
  NO_ACTIVE_DUTY: 'Start duty to continue.',
  NOT_ON_DUTY_AT_GATE: 'Start duty at this gate before recording a scan.',
  ALREADY_HANDLED: 'Someone has already handled this request.',
  VEHICLE_REQUIRED: 'Enter a vehicle number for this guest type.',
  CHILD_PROTECTION_BLOCKED: 'Child protection is on for this home.',
  HELPER_NOT_FOUND: 'The helper must have an account.',
  QR_INVALID: 'This visitor QR is invalid.',
  QR_EXPIRED: 'The entry window is closed.',
  QR_ALREADY_USED: 'Entry has already been recorded.',
  ENTRY_REQUIRED: 'Record entry before exit.',
  WRONG_SOCIETY: 'This visit belongs to another society.',
  VISIT_NOT_APPROVED: 'Wait for home approval before allowing entry.',
  INVALID_STATE: 'This action is unavailable in the current state.',
  UPLOAD_INVALID: 'Choose a supported file up to 5 MB.',
  INTERNAL_ERROR: 'The request could not be completed.'
} as const;
export type ErrorCode = keyof typeof messages;
export function errorMessage(code: string, message?: string, handledBy?: string) {
  if (code === 'ALREADY_HANDLED' && handledBy) return 'Already handled by ' + handledBy;
  if (code === 'INVALID_STATE' || code === 'INTERNAL_ERROR' || code === 'FORBIDDEN') return message || messages[code];
  return Object.hasOwn(messages, code) ? messages[code as ErrorCode] : message || 'The request could not be completed.';
}
