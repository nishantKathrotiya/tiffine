-- QStash message id for the pre-deadline reminder, kept separate from the
-- close callback so either can be cancelled independently.
alter table menu_days add column reminder_job_id text;
