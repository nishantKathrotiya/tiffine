-- The QStash message id for a day's scheduled deadline callback.
--
-- Stored so the callback can be cancelled or rescheduled when Deep changes the
-- deadline or closes ordering early. Without it, an edited deadline would leave
-- the original callback in flight and close the day at the old time.
alter table menu_days add column deadline_job_id text;
