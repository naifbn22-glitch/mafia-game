CREATE TABLE IF NOT EXISTS public.mafia_rooms (
  code varchar(12) PRIMARY KEY,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mafia_rooms_updated_idx
  ON public.mafia_rooms(updated_at);

ALTER TABLE public.mafia_rooms ENABLE ROW LEVEL SECURITY;

-- لا يحتاج المتصفح إلى الوصول المباشر لهذه الطاولة.
-- الخادم فقط يصل عبر DATABASE_URL، لذلك لا توجد سياسات عامة.
