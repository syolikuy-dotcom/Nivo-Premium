export type Role = 'user' | 'admin';
export type Shell = 'store' | 'app';

export interface SessionUser { id: number; username: string; email: string; name: string; role: Role; balance: number;  twofa: boolean }

export interface SiteInfo { name: string; tagline: string; logo: string; notice: string; wa: string; email: string; ig: string; turnstile: string; url: string; google: boolean }

export interface SiteSettings {
  site_name: string; tagline: string; logo_url: string; notice: string; wa_number: string; contact_email: string; instagram: string;
  markup_pct: number; markup_flat: number; am_price: number; min_deposit: number; max_deposit: number;
  low_balance_threshold: number; stuck_minutes: number; alert_email: string;
}

export interface SiteStats { sold: number; trx: number; users: number; today: number; online: number }

export interface ProductPub { id: number; slug: string; name: string; category: string; description: string; image: string | null; price: number; stock: number; available: boolean }

export type OrderStatus = 'pending' | 'paid' | 'processing' | 'success' | 'failed' | 'canceled' | 'expired';
export interface Account { username: string; password: string }
export interface OrderView {
  orderNo: string; product: string; qty: number; unitPrice: number; total: number; method: 'qris' | 'balance'; status: OrderStatus;
  createdAt: string; expiresAt: string | null; amountDue: number; uniqueCode: number | null; paidAt: string | null; completedAt: string | null;
  refunded: boolean; qr: string | null; accounts: Account[] | null; note: string | null;
}
export interface OrderListItem { orderNo: string; product: string; qty: number; total: number; status: OrderStatus; createdAt: string }

export type DepositStatus = 'pending' | 'paid' | 'failed' | 'canceled' | 'expired';
export interface DepositView { depositNo: string; amount: number; amountDue: number; uniqueCode: number | null; status: DepositStatus; createdAt: string; expiresAt: string | null; qr: string | null }
export interface DepositListItem { depositNo: string; amount: number; status: DepositStatus; createdAt: string }

export type AmStatus = 'processing' | 'pending_verify' | 'success' | 'failed' | 'canceled' | 'review';
export interface AmResult { email: string; link: string }
export interface AmView {
  orderNo: string; kind: 'single' | 'bulk'; email: string | null; qty: number; total: number; status: AmStatus; createdAt: string;
  refunded: boolean; results: AmResult[] | null;
}

export interface AdminProductRow { id: number; slug: string; premku_id: number | null; name: string; category: string; description: string | null; image_url: string | null; cost: number; price: number; price_locked: boolean; stock: number; active: boolean }
export interface AdminUserRow { id: number; username: string; email: string; name: string; role: Role; status: 'active' | 'disabled'; balance: number; last_login_at: string | null; created_at: string }
export interface AdminOrderRow { order_no: string; product_name: string; qty: number; total: number; pay_method: string; status: OrderStatus; fail_reason: string | null; attempts: number; refunded: boolean; created_at: string; username: string }
export interface AttnOrder { order_no: string; product_name: string; total: number; status: OrderStatus; fail_reason: string | null; attempts: number; created_at: string; username: string }
export interface AmReviewRow { order_no: string; kind: string; email: string | null; total: number; status: string; fail_reason: string | null; created_at: string; username: string }

export interface BaseProps { shell: Shell; user: SessionUser | null; site: SiteInfo; csrf: string; title?: string; admin?: boolean }
export type AuthedProps<T = unknown> = Omit<BaseProps, 'user'> & { user: SessionUser } & T;
export type PageProps<T = unknown> = BaseProps & T;

export interface CatalogFilters { q: string; category: string; min: number; max: number; sort: 'new' | 'price_asc' | 'price_desc' | 'name'; page: number; limit: number }

export type HomeProps = PageProps<{ stats: SiteStats; popular: ProductPub[] }>;
export type CatalogProps = PageProps<{ filters: CatalogFilters; categories: string[]; items: ProductPub[]; total: number; page: number; pages: number }>;
export type ProductProps = PageProps<{ product: ProductPub }>;
export type CheckoutProps = AuthedProps<{ product: ProductPub; qty: number }>;
export type LoginProps = PageProps<{ next: string; gerr: string }>;
export type RegisterProps = PageProps;
export type ForgotProps = PageProps;
export type ResetProps = PageProps<{ token: string }>;
export type DashboardProps = AuthedProps<{ since: string; lastLogin: string | null; spent: number; ok: number; waiting: number; recent: OrderListItem[]; stats: SiteStats }>;
export interface TwoFaView { available: boolean; enabled: boolean; recoveryLeft: number; required: boolean }
export type AccountProps = AuthedProps<{ joined: string; twofa: TwoFaView; google: { enabled: boolean; linked: boolean; flash: string } }>;
export interface OrderFilters { status: string; q: string; page: number }
export type OrdersProps = AuthedProps<{ list: OrderListItem[]; filters: OrderFilters; total: number; pages: number; counts: Record<string, number> }>;
export type OrderProps = AuthedProps<{ order: OrderView }>;
export type DepositProps = AuthedProps<{ list: DepositListItem[]; limits: { min: number; max: number } }>;
export type DepositViewProps = AuthedProps<{ deposit: DepositView }>;
export type AmProps = AuthedProps<{ tab: 'single' | 'bulk' | 'history'; price: number; pending: AmView[]; history: AmView[] }>;
export type SupplierState = 'unconfigured' | 'ok' | 'degraded' | 'down' | 'auth';
export interface StuckRow { kind: 'order' | 'am'; no: string; product: string; status: string; minutes: number; reason: string | null; username: string }
export interface AlertRow { key: string; state: 'ok' | 'firing'; since: string | null; lastSentAt: string | null; detail: string | null }
export interface HealthView {
  at: string;
  supplier: { state: SupplierState; saldo: number | null; saldoAt: string | null; lastOkAt: string | null; lastError: string | null; failures: number; breakerOpen: boolean; queued: number };
  threshold: number; lowBalance: boolean;
  stuck: { total: number; rows: StuckRow[]; minutes: number };
  worker: { lastTickAt: string | null; stale: boolean };
  smtp: boolean; alertRecipients: number;
  alerts: AlertRow[];
  admins: { total: number; with2fa: number };
}
export type AdminHomeProps = AuthedProps<{ revenue: number; ok: number; inflight: number; attn: AttnOrder[]; amReview: AmReviewRow[]; stats: SiteStats; health: HealthView }>;
export type AdminProductsProps = AuthedProps<{ q: string; rows: AdminProductRow[] }>;
export type AdminUsersProps = AuthedProps<{ q: string; rows: AdminUserRow[] }>;
export type AdminOrdersProps = AuthedProps<{ status: string; rows: AdminOrderRow[] }>;
export type AdminSettingsProps = AuthedProps<{ s: SiteSettings }>;
