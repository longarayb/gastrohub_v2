-- D040: creation order from the database. Each event table gets a sequence (seq); lists
-- sort by it, never by a clock (an app clock can go back, two API instances can disagree).

-- AuditLog: existing rows numbered in their creation order (createdAt, then id).
ALTER TABLE "AuditLog" ADD COLUMN "seq" BIGSERIAL NOT NULL;
UPDATE "AuditLog" AS t SET "seq" = o.rn FROM (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "AuditLog"
) AS o WHERE t."id" = o."id";
SELECT setval(pg_get_serial_sequence('"AuditLog"', 'seq'), COALESCE(MAX("seq"), 0) + 1, false) FROM "AuditLog";

-- CashMovement: existing rows numbered in their creation order (createdAt, then id).
ALTER TABLE "CashMovement" ADD COLUMN "seq" BIGSERIAL NOT NULL;
UPDATE "CashMovement" AS t SET "seq" = o.rn FROM (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "CashMovement"
) AS o WHERE t."id" = o."id";
SELECT setval(pg_get_serial_sequence('"CashMovement"', 'seq'), COALESCE(MAX("seq"), 0) + 1, false) FROM "CashMovement";

-- CourierLedgerEntry: existing rows numbered in their creation order (createdAt, then id).
ALTER TABLE "CourierLedgerEntry" ADD COLUMN "seq" BIGSERIAL NOT NULL;
UPDATE "CourierLedgerEntry" AS t SET "seq" = o.rn FROM (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "CourierLedgerEntry"
) AS o WHERE t."id" = o."id";
SELECT setval(pg_get_serial_sequence('"CourierLedgerEntry"', 'seq'), COALESCE(MAX("seq"), 0) + 1, false) FROM "CourierLedgerEntry";

-- DeliveryStop: existing rows numbered in their creation order (dispatchedAt, then id).
ALTER TABLE "DeliveryStop" ADD COLUMN "seq" BIGSERIAL NOT NULL;
UPDATE "DeliveryStop" AS t SET "seq" = o.rn FROM (
  SELECT "id", row_number() OVER (ORDER BY "dispatchedAt", "id") AS rn FROM "DeliveryStop"
) AS o WHERE t."id" = o."id";
SELECT setval(pg_get_serial_sequence('"DeliveryStop"', 'seq'), COALESCE(MAX("seq"), 0) + 1, false) FROM "DeliveryStop";

-- OrderItem: existing rows numbered in their creation order (createdAt, then id).
ALTER TABLE "OrderItem" ADD COLUMN "seq" BIGSERIAL NOT NULL;
UPDATE "OrderItem" AS t SET "seq" = o.rn FROM (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "OrderItem"
) AS o WHERE t."id" = o."id";
SELECT setval(pg_get_serial_sequence('"OrderItem"', 'seq'), COALESCE(MAX("seq"), 0) + 1, false) FROM "OrderItem";

-- OrderRound: existing rows numbered in their creation order (createdAt, then id).
ALTER TABLE "OrderRound" ADD COLUMN "seq" BIGSERIAL NOT NULL;
UPDATE "OrderRound" AS t SET "seq" = o.rn FROM (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "OrderRound"
) AS o WHERE t."id" = o."id";
SELECT setval(pg_get_serial_sequence('"OrderRound"', 'seq'), COALESCE(MAX("seq"), 0) + 1, false) FROM "OrderRound";

-- OrderStatusHistory: existing rows numbered in their creation order (createdAt, then id).
ALTER TABLE "OrderStatusHistory" ADD COLUMN "seq" BIGSERIAL NOT NULL;
UPDATE "OrderStatusHistory" AS t SET "seq" = o.rn FROM (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "OrderStatusHistory"
) AS o WHERE t."id" = o."id";
SELECT setval(pg_get_serial_sequence('"OrderStatusHistory"', 'seq'), COALESCE(MAX("seq"), 0) + 1, false) FROM "OrderStatusHistory";

-- Payment: existing rows numbered in their creation order (createdAt, then id).
ALTER TABLE "Payment" ADD COLUMN "seq" BIGSERIAL NOT NULL;
UPDATE "Payment" AS t SET "seq" = o.rn FROM (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "Payment"
) AS o WHERE t."id" = o."id";
SELECT setval(pg_get_serial_sequence('"Payment"', 'seq'), COALESCE(MAX("seq"), 0) + 1, false) FROM "Payment";

-- PrintJob: existing rows numbered in their creation order (createdAt, then id).
ALTER TABLE "PrintJob" ADD COLUMN "seq" BIGSERIAL NOT NULL;
UPDATE "PrintJob" AS t SET "seq" = o.rn FROM (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "PrintJob"
) AS o WHERE t."id" = o."id";
SELECT setval(pg_get_serial_sequence('"PrintJob"', 'seq'), COALESCE(MAX("seq"), 0) + 1, false) FROM "PrintJob";

-- ProductionTask: existing rows numbered in their creation order (sentAt, then id).
ALTER TABLE "ProductionTask" ADD COLUMN "seq" BIGSERIAL NOT NULL;
UPDATE "ProductionTask" AS t SET "seq" = o.rn FROM (
  SELECT "id", row_number() OVER (ORDER BY "sentAt", "id") AS rn FROM "ProductionTask"
) AS o WHERE t."id" = o."id";
SELECT setval(pg_get_serial_sequence('"ProductionTask"', 'seq'), COALESCE(MAX("seq"), 0) + 1, false) FROM "ProductionTask";

