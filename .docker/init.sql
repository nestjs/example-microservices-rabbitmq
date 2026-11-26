-- One database per service, and one per service for the e2e tests (they truncate their tables).
CREATE DATABASE orders;
CREATE DATABASE fulfillment;
CREATE DATABASE orders_test;
CREATE DATABASE fulfillment_test;
