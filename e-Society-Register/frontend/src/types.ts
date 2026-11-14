export interface User { id: string; firstName: string; lastName: string | null; phone: string; dateOfBirth: string; profilePhotoUrl: string | null; isPlatformAdmin: boolean }
export type Status = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'REMOVED';
export interface Society { id: string; name: string; city: string; state: string; country: string; address: string; pincode: string; latitude: number | null; longitude: number | null; status: Status; rejectionReason: string | null; secretaryUserId: string; createdAt: string }
export interface Flat { id: string; societyId: string; label: string; wing: string; flatNumber: string; floorNumber: number | null; status: Status; childProtection: boolean; muteVisitorAlerts: boolean }
export interface Member { id: string; flatId: string; user: User; role: 'HEAD' | 'MEMBER'; status: Status; relation: string; canApproveVisitors: boolean; approvedAt: string | null }
export interface Gate { id: string; societyId: string; gateNumber: string; name: string | null; isActive: boolean }
export interface Duty { id: string; guardId: string; societyId: string; startedAt: string; endedAt: string | null; gates: Gate[] }
export interface Me { user: User; secretaryOf: Society | null; guardIn: { guard: Guard; society: Society }[]; flats: { member: Member; flat: Flat; society: { id: string; name: string; status: Status } }[] }
export interface Guest { id: string; name: string; requiresVehicleNumber: boolean; defaultValidMinutes: number; isActive: boolean }
export const visitStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'NO_RESPONSE', 'CANCELLED', 'CHECKED_IN', 'CHECKED_OUT', 'EXPIRED'] as const;
export interface Visit { id: string; societyId: string; society?: { id: string; name: string }; flat: { id: string; label: string }; guestType: Guest; purpose: string; vehicleNumber: string | null;
  status: typeof visitStatuses[number]; isWalkIn: boolean; visitor: { name: string; phone: string | null; photoUrl: string | null } | null;
  validFrom: string | null; validUntil: string | null; createdAt: string; entryAt: string | null; exitAt: string | null;
  respondedBy: { id: string; name: string } | null; respondedAt: string | null; qrToken?: string; isOverstayed: boolean; recurringPassId: string | null }
export const fullName = (user: User) => [user.firstName, user.lastName].filter(Boolean).join(' ') || user.phone;

export interface SocietyDocument { id: string; societyId: string; documentType: string; fileUrl: string }
export interface Guard { id: string; societyId: string; user: User; status: 'PENDING' | 'APPROVED' | 'REMOVED'; approvedAt: string | null }
export interface RecurringPass {
  id: string; flatId: string; helper: User; guestType: Guest; daysOfWeek: number[];
  startTime: string; endTime: string; validFrom: string; validTo: string | null; isActive: boolean;
}
export interface WalkInProfile { id: string; societyId: string; phone: string; name: string; photoUrl: string | null }
export interface EmergencyLog {
  id: string; societyId: string; gate: Gate; guard: { id: string; name: string };
  type: 'AMBULANCE' | 'FIRE' | 'POLICE' | 'OTHER'; vehicleNumber: string | null; note: string | null; createdAt: string;
}
export interface AuditEntry {
  id: string; societyId: string | null; actor: { id: string; name: string }; action: string;
  entityType: string; entityId: string; metadata: Record<string, unknown>; createdAt: string;
}
export type VisitWithQr = Visit & { qrToken: string };
