-- Prevent active duplicate Order Later rows for the same source order_item.
-- This complements app-side checks and protects against race conditions.

DO $$
BEGIN
  IF to_regclass('public.order_later_items') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'order_later_items'
        AND column_name = 'source_order_item_id'
    ) THEN
      -- Keep the oldest active row and cancel newer duplicates.
      WITH ranked AS (
        SELECT
          id,
          row_number() OVER (
            PARTITION BY source_order_item_id
            ORDER BY created_at ASC, id ASC
          ) AS rn
        FROM public.order_later_items
        WHERE source_order_item_id IS NOT NULL
          AND status IN ('queued', 'added')
      )
      UPDATE public.order_later_items AS oli
      SET
        status = 'cancelled',
        cancelled_at = COALESCE(oli.cancelled_at, NOW())
      FROM ranked
      WHERE oli.id = ranked.id
        AND ranked.rn > 1
        AND oli.status IN ('queued', 'added');

      EXECUTE '
        CREATE UNIQUE INDEX IF NOT EXISTS order_later_items_active_source_order_item_uidx
        ON public.order_later_items (source_order_item_id)
        WHERE source_order_item_id IS NOT NULL
          AND status IN (''queued'', ''added'')
      ';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'order_later_items'
        AND column_name = 'location_id'
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS order_later_items_status_location_scheduled_idx
        ON public.order_later_items (status, location_id, scheduled_at)
      ';
    END IF;
  END IF;

  IF to_regclass('public.order_items') IS NOT NULL THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS order_items_status_idx
      ON public.order_items (status)
    ';
  END IF;
END $$;
