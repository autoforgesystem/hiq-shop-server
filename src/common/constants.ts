/** Allowed values for the string columns in prisma/schema.prisma. The front-end uses the same codes. */
export const CATEGORIES = ['under-sink', 'countertop', 'dispensers', 'whole-house', 'commercial', 'industrial', 'emergency'] as const;
export const CHANNELS = ['shop', 'quote'] as const;
export const NEED_CODES = ['home', 'condo', 'office', 'business'] as const;
export const FILTRATION_CODES = ['UF', 'Nano', 'RO', 'UV', 'Alkaline'] as const;

export const ORDER_STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'] as const;
export const PAYMENT_METHODS = ['card', 'gcash', 'maya', 'online_banking'] as const;
export const LINE_MODES = ['buy', 'rent'] as const;
export const SLOTS = ['morning', 'afternoon', 'late-afternoon'] as const;

/** Same ids as SERVICES in apps/src/pages/Service.tsx. */
export const SERVICES = ['installation', 'water-test', 'maintenance', 'filter-replacement', 'warranty', 'troubleshooting', 'general'] as const;
export const BOOKING_STATUSES = ['requested', 'confirmed', 'done', 'cancelled'] as const;
export const WARRANTY_STATUSES = ['active', 'expired', 'void'] as const;
export const CLAIM_STATUSES = ['submitted', 'approved', 'rejected', 'resolved'] as const;
export const SUBSCRIPTION_STATUSES = ['active', 'paused', 'cancelled'] as const;

export const LEAD_TYPES = ['quote', 'rental', 'contact', 'newsletter', 'business'] as const;
export const LEAD_STATUSES = ['new', 'contacted', 'won', 'lost'] as const;
export const ADMIN_ROLES = ['owner', 'editor'] as const;

/** Reminders go out this many days before a filter is due (see docs in apps/docs/API.md). */
export const REMINDER_DAYS = [30, 7] as const;
