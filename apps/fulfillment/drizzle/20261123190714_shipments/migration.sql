CREATE TABLE "shipments" (
	"order_id" uuid PRIMARY KEY,
	"status" text DEFAULT 'preparing' NOT NULL,
	"customer_email" text NOT NULL,
	"shipping_address" text NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
