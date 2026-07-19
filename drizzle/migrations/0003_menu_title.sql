-- Menus are entered by hand rather than parsed, so a day carries a title Deep
-- types (e.g. "Thursday Special") instead of the raw forwarded text.

alter table menu_days add column title text;

-- raw_menu_text was only meaningful as the audit trail for AI parsing. Keeping
-- it would leave a column nothing writes and nothing reads.
alter table menu_days drop column raw_menu_text;
