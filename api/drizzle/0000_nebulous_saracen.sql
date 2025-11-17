CREATE TABLE "pools" (
	"id" varchar PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"coin" varchar,
	"order_book" varchar,
	"base_currency" varchar NOT NULL,
	"quote_currency" varchar NOT NULL,
	"base_decimals" integer,
	"quote_decimals" integer,
	"volume" bigint,
	"volume_in_quote" bigint,
	"price" bigint,
	"timestamp" integer
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"pool_id" varchar NOT NULL,
	"order_id" bigint NOT NULL,
	"transaction_id" text,
	"user" varchar,
	"side" varchar,
	"timestamp" integer,
	"price" bigint,
	"quantity" bigint,
	"filled" bigint,
	"type" varchar,
	"status" varchar,
	"expiry" integer
);
--> statement-breakpoint
CREATE TABLE "order_book_trades" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"price" bigint,
	"quantity" bigint,
	"timestamp" integer,
	"transaction_id" text,
	"side" varchar,
	"pool_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_book_depth" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"pool_id" varchar NOT NULL,
	"side" varchar NOT NULL,
	"price" bigint NOT NULL,
	"quantity" bigint NOT NULL,
	"order_count" integer NOT NULL,
	"last_updated" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_buckets" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"open_time" integer NOT NULL,
	"close_time" integer NOT NULL,
	"open" real NOT NULL,
	"high" real NOT NULL,
	"low" real NOT NULL,
	"close" real NOT NULL,
	"volume" real NOT NULL,
	"quote_volume" real NOT NULL,
	"count" integer NOT NULL,
	"taker_buy_base_volume" real NOT NULL,
	"taker_buy_quote_volume" real NOT NULL,
	"average" real NOT NULL,
	"pool_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "five_minute_buckets" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"open_time" integer NOT NULL,
	"close_time" integer NOT NULL,
	"open" real NOT NULL,
	"high" real NOT NULL,
	"low" real NOT NULL,
	"close" real NOT NULL,
	"volume" real NOT NULL,
	"quote_volume" real NOT NULL,
	"count" integer NOT NULL,
	"taker_buy_base_volume" real NOT NULL,
	"taker_buy_quote_volume" real NOT NULL,
	"average" real NOT NULL,
	"pool_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hour_buckets" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"open_time" integer NOT NULL,
	"close_time" integer NOT NULL,
	"open" real NOT NULL,
	"high" real NOT NULL,
	"low" real NOT NULL,
	"close" real NOT NULL,
	"volume" real NOT NULL,
	"quote_volume" real NOT NULL,
	"count" integer NOT NULL,
	"taker_buy_base_volume" real NOT NULL,
	"taker_buy_quote_volume" real NOT NULL,
	"average" real NOT NULL,
	"pool_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "minute_buckets" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"open_time" integer NOT NULL,
	"close_time" integer NOT NULL,
	"open" real NOT NULL,
	"high" real NOT NULL,
	"low" real NOT NULL,
	"close" real NOT NULL,
	"volume" real NOT NULL,
	"quote_volume" real NOT NULL,
	"count" integer NOT NULL,
	"taker_buy_base_volume" real NOT NULL,
	"taker_buy_quote_volume" real NOT NULL,
	"average" real NOT NULL,
	"pool_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thirty_minute_buckets" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"open_time" integer NOT NULL,
	"close_time" integer NOT NULL,
	"open" real NOT NULL,
	"high" real NOT NULL,
	"low" real NOT NULL,
	"close" real NOT NULL,
	"volume" real NOT NULL,
	"quote_volume" real NOT NULL,
	"count" integer NOT NULL,
	"taker_buy_base_volume" real NOT NULL,
	"taker_buy_quote_volume" real NOT NULL,
	"average" real NOT NULL,
	"pool_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "balances" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"user" varchar NOT NULL,
	"currency" varchar NOT NULL,
	"amount" bigint,
	"locked_amount" bigint,
	"timestamp" integer
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"address" varchar NOT NULL,
	"symbol" varchar,
	"name" varchar,
	"decimals" integer,
	"timestamp" integer
);
--> statement-breakpoint
CREATE TABLE "faucet_rate_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"identifier" varchar(100) NOT NULL,
	"identifier_type" varchar(10) NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"last_request_time" timestamp with time zone NOT NULL,
	"cooldown_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "faucet_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"requester_address" varchar(42) NOT NULL,
	"receiver_address" varchar(42) NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"token_symbol" varchar(20) NOT NULL,
	"token_decimals" integer NOT NULL,
	"amount" bigint NOT NULL,
	"amount_formatted" varchar(50) NOT NULL,
	"status" varchar(20) NOT NULL,
	"transaction_hash" varchar(66),
	"gas_used" bigint,
	"gas_price" bigint,
	"error_message" text,
	"request_timestamp" timestamp with time zone NOT NULL,
	"completed_timestamp" timestamp with time zone,
	"ip_address" varchar(45),
	"user_agent" text
);
--> statement-breakpoint
CREATE INDEX "pools_coin_idx" ON "pools" USING btree ("coin");--> statement-breakpoint
CREATE INDEX "pools_chain_id_idx" ON "pools" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "pools_order_book_idx" ON "pools" USING btree ("order_book");--> statement-breakpoint
CREATE INDEX "orders_order_id_chain_idx" ON "orders" USING btree ("order_id","chain_id");--> statement-breakpoint
CREATE INDEX "orders_pool_chain_status_idx" ON "orders" USING btree ("pool_id","chain_id","status");--> statement-breakpoint
CREATE INDEX "orders_pool_status_side_idx" ON "orders" USING btree ("pool_id","status","side");--> statement-breakpoint
CREATE INDEX "orders_depth_optimized_idx" ON "orders" USING btree ("pool_id","status","side","price");--> statement-breakpoint
CREATE INDEX "orders_user_timestamp_idx" ON "orders" USING btree ("user","timestamp");--> statement-breakpoint
CREATE INDEX "orders_user_status_timestamp_idx" ON "orders" USING btree ("user","status","timestamp");--> statement-breakpoint
CREATE INDEX "orders_pool_idx" ON "orders" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_timestamp_idx" ON "orders" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user");--> statement-breakpoint
CREATE INDEX "order_book_trades_transaction_idx" ON "order_book_trades" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "order_book_trades_pool_idx" ON "order_book_trades" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "order_book_trades_chain_id_idx" ON "order_book_trades" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "order_book_trades_pool_chain_timestamp_idx" ON "order_book_trades" USING btree ("pool_id","chain_id","timestamp");--> statement-breakpoint
CREATE INDEX "order_book_trades_side_idx" ON "order_book_trades" USING btree ("side");--> statement-breakpoint
CREATE INDEX "order_book_trades_timestamp_idx" ON "order_book_trades" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "order_book_depth_pool_side_idx" ON "order_book_depth" USING btree ("pool_id","side");--> statement-breakpoint
CREATE INDEX "order_book_depth_pool_price_idx" ON "order_book_depth" USING btree ("pool_id","price");--> statement-breakpoint
CREATE INDEX "order_book_depth_chain_id_idx" ON "order_book_depth" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "order_book_depth_last_updated_idx" ON "order_book_depth" USING btree ("last_updated");--> statement-breakpoint
CREATE INDEX "order_book_depth_pool_chain_side_idx" ON "order_book_depth" USING btree ("pool_id","chain_id","side");--> statement-breakpoint
CREATE INDEX "order_book_depth_pool_chain_side_price_idx" ON "order_book_depth" USING btree ("pool_id","chain_id","side","price");--> statement-breakpoint
CREATE INDEX "order_book_depth_quantity_idx" ON "order_book_depth" USING btree ("quantity");--> statement-breakpoint
CREATE INDEX "daily_buckets_open_time_idx" ON "daily_buckets" USING btree ("open_time");--> statement-breakpoint
CREATE INDEX "daily_buckets_pool_idx" ON "daily_buckets" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "daily_buckets_chain_id_idx" ON "daily_buckets" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "daily_buckets_pool_open_time_idx" ON "daily_buckets" USING btree ("pool_id","open_time");--> statement-breakpoint
CREATE INDEX "daily_buckets_pool_chain_open_time_idx" ON "daily_buckets" USING btree ("pool_id","chain_id","open_time");--> statement-breakpoint
CREATE INDEX "daily_buckets_close_time_idx" ON "daily_buckets" USING btree ("close_time");--> statement-breakpoint
CREATE INDEX "five_minute_buckets_open_time_idx" ON "five_minute_buckets" USING btree ("open_time");--> statement-breakpoint
CREATE INDEX "five_minute_buckets_pool_idx" ON "five_minute_buckets" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "five_minute_buckets_chain_id_idx" ON "five_minute_buckets" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "five_minute_buckets_pool_open_time_idx" ON "five_minute_buckets" USING btree ("pool_id","open_time");--> statement-breakpoint
CREATE INDEX "five_minute_buckets_pool_chain_open_time_idx" ON "five_minute_buckets" USING btree ("pool_id","chain_id","open_time");--> statement-breakpoint
CREATE INDEX "five_minute_buckets_close_time_idx" ON "five_minute_buckets" USING btree ("close_time");--> statement-breakpoint
CREATE INDEX "hour_buckets_open_time_idx" ON "hour_buckets" USING btree ("open_time");--> statement-breakpoint
CREATE INDEX "hour_buckets_pool_idx" ON "hour_buckets" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "hour_buckets_chain_id_idx" ON "hour_buckets" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "hour_buckets_pool_open_time_idx" ON "hour_buckets" USING btree ("pool_id","open_time");--> statement-breakpoint
CREATE INDEX "hour_buckets_pool_chain_open_time_idx" ON "hour_buckets" USING btree ("pool_id","chain_id","open_time");--> statement-breakpoint
CREATE INDEX "hour_buckets_close_time_idx" ON "hour_buckets" USING btree ("close_time");--> statement-breakpoint
CREATE INDEX "minute_buckets_open_time_idx" ON "minute_buckets" USING btree ("open_time");--> statement-breakpoint
CREATE INDEX "minute_buckets_pool_idx" ON "minute_buckets" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "minute_buckets_chain_id_idx" ON "minute_buckets" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "minute_buckets_pool_open_time_idx" ON "minute_buckets" USING btree ("pool_id","open_time");--> statement-breakpoint
CREATE INDEX "minute_buckets_pool_chain_open_time_idx" ON "minute_buckets" USING btree ("pool_id","chain_id","open_time");--> statement-breakpoint
CREATE INDEX "minute_buckets_close_time_idx" ON "minute_buckets" USING btree ("close_time");--> statement-breakpoint
CREATE INDEX "thirty_minute_buckets_open_time_idx" ON "thirty_minute_buckets" USING btree ("open_time");--> statement-breakpoint
CREATE INDEX "thirty_minute_buckets_pool_idx" ON "thirty_minute_buckets" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "thirty_minute_buckets_chain_id_idx" ON "thirty_minute_buckets" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "thirty_minute_buckets_pool_open_time_idx" ON "thirty_minute_buckets" USING btree ("pool_id","open_time");--> statement-breakpoint
CREATE INDEX "thirty_minute_buckets_pool_chain_open_time_idx" ON "thirty_minute_buckets" USING btree ("pool_id","chain_id","open_time");--> statement-breakpoint
CREATE INDEX "thirty_minute_buckets_close_time_idx" ON "thirty_minute_buckets" USING btree ("close_time");--> statement-breakpoint
CREATE INDEX "balances_user_idx" ON "balances" USING btree ("user");--> statement-breakpoint
CREATE INDEX "balances_user_currency_idx" ON "balances" USING btree ("user","currency");--> statement-breakpoint
CREATE INDEX "balances_chain_id_idx" ON "balances" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "balances_currency_idx" ON "balances" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "balances_user_chain_currency_idx" ON "balances" USING btree ("user","chain_id","currency");--> statement-breakpoint
CREATE INDEX "balances_timestamp_idx" ON "balances" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "currencies_address_chain_idx" ON "currencies" USING btree ("address","chain_id");--> statement-breakpoint
CREATE INDEX "currencies_symbol_idx" ON "currencies" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "currencies_chain_id_idx" ON "currencies" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "currencies_address_idx" ON "currencies" USING btree ("address");