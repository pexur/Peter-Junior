"use client";
import { LanguageToggle, useI18n } from "./i18n/provider";


import { DailyTimeline } from "./daily-timeline";
import { slotsSnapshot, type DaySlot, type BlockChange } from "./day-blocks";
import { TaskStation } from "./task-station";
import { ThingsLibrary } from "./things-library";
import type { ActivitySession } from "./voice-types";
import { useEffect, useMemo, useRef, useState } from "react";

import { ListMutationQueue, type AppState, type ListNode, type Mutation } from "./list-state";
import { PlanningBoard, type BoardAction, type BoardState, type PlanningCard } from "./planning-board";

type SlotResponse = { activities?: ActivitySession[]; slots: DaySlot[]; counts: { date: string; count: number }[]; error?: string };

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function historyDateKey(value: string) {
  return dateKey(new Date(`${value.replace(" ", "T")}Z`));
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateTitle(value: string, language: string) {
  return new Intl.DateTimeFormat(language, { weekday: "long", month: "long", day: "numeric" }).format(dateFromKey(value));
}

function monthCells(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export default function Home() {
  const { tr, language } = useI18n();
  const today = dateKey(new Date());
  const [data, setData] = useState<AppState>({ nodes: [], history: [], reviews: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState(today);
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [reviewText, setReviewText] = useState("");
  const [reviewStatus, setReviewStatus] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const reviewInFlight = useRef(false);
  const selectedReview = data.reviews.find((review) => review.date === selectedDate);
  const selectedReviewNotes = selectedReview?.notes ?? "";
  const starredReviews = data.reviews.filter((review) => review.starred);
  const [slots, setSlots] = useState<DaySlot[]>([]);
  const [activities, setActivities] = useState<ActivitySession[]>([]);
  const [slotCounts, setSlotCounts] = useState<Map<string, number>>(new Map());
  const [scheduleStatus, setScheduleStatus] = useState("");
  const [armedItemId, setArmedItemId] = useState<string | null>(null);
  const [board, setBoard] = useState<BoardState>({ columns: [], cards: [] });
  const [boardStatus, setBoardStatus] = useState("Loading ideas…");
  const [boardCollapsed, setBoardCollapsed] = useState(true);
  const [workstation, setWorkstation] = useState(false);
  const [armedBoardCardId, setArmedBoardCardId] = useState<string | null>(null);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const scheduleInFlight = useRef(false);
  const currentDateRef = useRef(selectedDate);
  const [pendingCount, setPendingCount] = useState(0);
  const [mutationQueue] = useState(() => new ListMutationQueue(async (payload) => {
    const response = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as AppState & { error?: string };
    if (!response.ok) throw new Error(result.error || "Could not save your changes.");
    window.dispatchEvent(new Event("nextup:changed"));
    return result;
  }, (state, pending) => { setData(state); setPendingCount(pending); }));

  const historyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    data.history.forEach((entry) => counts.set((entry.occurredDate || historyDateKey(entry.createdAt)), (counts.get((entry.occurredDate || historyDateKey(entry.createdAt))) ?? 0) + 1));
    return counts;
  }, [data.history]);
  const legacyDidCounts = useMemo(() => {
    const counts = new Map<string, number>();
    data.history.filter((entry) => entry.action === "item_did").forEach((entry) => counts.set((entry.occurredDate || historyDateKey(entry.createdAt)), (counts.get((entry.occurredDate || historyDateKey(entry.createdAt))) ?? 0) + 1));
    return counts;
  }, [data.history]);
  const reviewDates = useMemo(() => new Set(data.reviews.filter((review) => review.notes.trim()).map((review) => review.date)), [data.reviews]);
  const calendarDays = useMemo(() => monthCells(visibleMonth), [visibleMonth]);
  async function loadState() {
    try {
      const response = await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ensureCategories" }) });
      if (!response.ok) throw new Error("Could not load your list.");
      const state = (await response.json()) as AppState;
      mutationQueue.reset(state);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  // This one-time load owns the initial client state hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void loadState(); }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/board", { cache: "no-store" }).then(async (response) => {
      const result = (await response.json()) as BoardState;
      if (!response.ok) throw new Error(result.error || "Could not load your planning board.");
      if (!cancelled) { setBoard(result); setBoardStatus(""); }
    }).catch((loadError) => { if (!cancelled) setBoardStatus(loadError instanceof Error ? loadError.message : "Could not load your planning board."); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (window.localStorage.getItem("next-up-board-collapsed") !== null) {
      // This is a device-local display preference, not product data.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBoardCollapsed(window.localStorage.getItem("next-up-board-collapsed") === "true");
    }
  }, []);

  useEffect(() => {
    // The selected date determines which persisted note is being edited.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReviewText(selectedReviewNotes);
    setReviewStatus("");
  }, [selectedReviewNotes, selectedDate]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/slots?date=${encodeURIComponent(selectedDate)}&timezoneOffset=${new Date().getTimezoneOffset()}`, { cache: "no-store" })
      .then(async (response) => {
        const result = (await response.json()) as SlotResponse;
        if (!response.ok) throw new Error(result.error || "Could not load the day schedule.");
        if (!cancelled) {
          setSlots(result.slots);
          setActivities(result.activities || []);
          setSlotCounts(new Map(result.counts.map((entry) => [entry.date, entry.count])));
          setScheduleStatus("");
          setScheduleLoading(false);
        }
      })
      .catch((loadError) => { if (!cancelled) { setScheduleLoading(false); setScheduleStatus(loadError instanceof Error ? loadError.message : "Could not load the day schedule."); } });
    return () => { cancelled = true; };
  }, [selectedDate]);

  useEffect(() => {
    if (!pendingCount) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pendingCount]);

  async function mutate(payload: Mutation) {
    setError("");
    try { return await mutationQueue.enqueue(payload); }
    catch (actionError) {
      setError(`${actionError instanceof Error ? actionError.message : "Could not save."} Unsaved list actions were reverted. Please try again.`);
      throw actionError;
    }
  }

  async function boardAction(payload: BoardAction) {
    setBoardStatus("Saving board…");
    try {
      const response = await fetch("/api/board", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = (await response.json()) as BoardState;
      if (!response.ok) throw new Error(result.error || "Could not update the planning board.");
      setBoard(result);
      window.dispatchEvent(new Event("nextup:changed"));
      setBoardStatus("Saved");
      window.setTimeout(() => setBoardStatus(""), 1200);
      return true;
    } catch (boardError) {
      setBoardStatus(boardError instanceof Error ? boardError.message : "Could not update the planning board.");
      return false;
    }
  }

  async function promoteCard(cardId: string, targetParentId: string | null) {
    setBoardStatus("Moving idea into Things…");
    try {
      const response = await fetch("/api/board", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "promoteCard", cardId, targetParentId, nodeId: crypto.randomUUID() }) });
      const result = (await response.json()) as BoardState;
      if (!response.ok) throw new Error(result.error || "Could not move that idea.");
      setBoard(result);
      window.dispatchEvent(new Event("nextup:changed"));
      setArmedBoardCardId(null);
      await loadState();
      setBoardStatus(targetParentId ? "Added inside the list." : "Added to Things.");
      window.setTimeout(() => setBoardStatus(""), 1600);
    } catch (promotionError) {
      setBoardStatus(`${promotionError instanceof Error ? promotionError.message : "Could not move that idea."} It is still on your board.`);
    }
  }

  function armBoardCard(card: PlanningCard | null) {
    setArmedBoardCardId(card?.id ?? null);
    if (card) {
      requestAnimationFrame(() => document.querySelector(".list-panel")?.scrollIntoView({ behavior: "smooth" }));
    }
    setBoardStatus(card ? `“${card.title}” selected. Choose a list or the top-level drop area.` : "");
  }

  async function journalAction(payload: { action: "saveReview"; date: string; notes: string; starred?: boolean } | { action: "setReviewStar"; date: string; starred: boolean } | { action: "removeHistory"; eventId: number }) {
    setError("");
    const response = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as AppState & { error?: string };
    if (!response.ok) throw new Error(result.error || "Could not update your journal.");
    mutationQueue.reset(result);
  }

  async function saveReview(starred?: boolean) {
    if (reviewInFlight.current) return;
    reviewInFlight.current = true;
    setReviewBusy(true);
    setReviewStatus("Saving…");
    try {
      await journalAction({ action: "saveReview", date: selectedDate, notes: reviewText, ...(starred === undefined ? {} : { starred }) });
      setReviewStatus(starred === true ? "Starred — kept here until you unstar it" : "Saved");
    } catch (reviewError) {
      setReviewStatus(reviewError instanceof Error ? reviewError.message : "Could not save your review.");
    } finally {
      reviewInFlight.current = false;
      setReviewBusy(false);
    }
  }

  async function unstarReview(date: string) {
    if (reviewInFlight.current) return;
    reviewInFlight.current = true;
    setReviewBusy(true);
    try {
      await journalAction({ action: "setReviewStar", date, starred: false });
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Could not unstar this thought.");
    } finally {
      reviewInFlight.current = false;
      setReviewBusy(false);
    }
  }

  async function updateBlock(change: BlockChange) {
    if (scheduleInFlight.current || scheduleLoading) return false;
    const date = selectedDate;
    scheduleInFlight.current = true; setScheduleBusy(true);
    setScheduleStatus("Saving block…");
    try {
      const response = await fetch("/api/slots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...change, date, expectedSlots: slotsSnapshot(slots), timezoneOffset: new Date().getTimezoneOffset() }) });
      const result = (await response.json()) as SlotResponse;
      if (currentDateRef.current !== date) return response.ok;
      if (result.slots) {
        setSlots(result.slots); setActivities(result.activities || []);
        setSlotCounts(new Map(result.counts.map(entry => [entry.date, entry.count])));
      }
      if (!response.ok) throw new Error(result.error || "Could not save the block.");
      setScheduleStatus(change.action === "clearRange" ? "Block removed." : "Block saved.");
      return true;
    } catch (error) {
      if (currentDateRef.current === date) setScheduleStatus(error instanceof Error ? error.message : "Could not save the block.");
      return false;
    } finally { scheduleInFlight.current = false; setScheduleBusy(false); }
  }

  function armItem(node: ListNode) {
    setArmedItemId((current) => current === node.id ? null : node.id);
    setScheduleStatus(armedItemId === node.id ? "" : `“${node.title}” selected. Choose an empty time.`);
  }

  function selectDay(day: Date) {
    const nextDate = dateKey(day);
    if (nextDate !== selectedDate) {
      currentDateRef.current = nextDate;
      setScheduleLoading(true);
      setSlots([]); setActivities([]);
      setArmedItemId(null);
      setScheduleStatus("Loading schedule…");
      setSelectedDate(nextDate);
    }
    setVisibleMonth(new Date(day.getFullYear(), day.getMonth(), 1));
  }

  if (workstation) return <main className="workstation-page">
    <TaskStation nodes={data.nodes} loading={loading} pending={pendingCount} error={error} mutate={mutate} onExit={() => setWorkstation(false)} />
  </main>;

  return (
    <main className="page-shell station-page" id="top">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label={tr("Personal Daily home")}>{tr("Personal Daily")}</a>
        <LanguageToggle /><nav className="view-navigation" aria-label={tr("Views")}><a className="voice-nav" href="/voice">{tr("Voice Inbox")}</a></nav>
      </header>
      <nav className="section-navigation" aria-label={tr("On this page")}>
        <a href="#ideas">{tr("Planning")}</a><a href="#tasks">{tr("Tasks")}</a><a href="#journal">{tr("Journal")}</a><a href="#history">{tr("History")}</a>
      </nav>

      <div className="workspace">
      <div id="ideas">
        <PlanningBoard board={board} collapsed={boardCollapsed} status={boardStatus} armedCardId={armedBoardCardId} onCollapsedChange={(next) => { setBoardCollapsed(next); window.localStorage.setItem("next-up-board-collapsed", String(next)); }} onAction={boardAction} onArmCard={armBoardCard} />
      </div>

        <section className="list-panel" id="tasks" aria-label={tr("Tasks")}>
          <ThingsLibrary workstationAction={<button className="station-back" onClick={() => setWorkstation(true)}>{tr("Turn on workstation")}</button>} nodes={data.nodes} loading={loading} pending={pendingCount} error={error} mutate={mutate} onSchedule={armItem} armedCardId={armedBoardCardId} onPromote={promoteCard} dailyView={<DailyTimeline key={selectedDate} slots={slots} date={selectedDate} today={today} nodes={data.nodes} armedId={armedItemId} busy={scheduleBusy} loading={scheduleLoading} status={scheduleStatus} onChange={updateBlock} onDate={date => selectDay(dateFromKey(date))} onArm={setArmedItemId} />} />
        </section>


        <section className="journal-panel" aria-labelledby="journal-heading">
          {starredReviews.length > 0 && <section className="starred-thoughts" aria-labelledby="starred-thoughts-heading">
            <h3 id="starred-thoughts-heading">{tr("Starred thoughts")}</h3>
            <p className="starred-hint">{tr("Things to address. Kept here until you unstar them.")}</p>
            <div className="starred-thought-grid">{starredReviews.map((review) => <article className="thought-card" key={review.date}>
              <div className="thought-card-heading"><time dateTime={review.date}>{tr(dateTitle(review.date, language))}</time><button type="button" aria-label={tr("Unstar thought from " + dateTitle(review.date, language))} aria-pressed={true} disabled={reviewBusy} onClick={() => void unstarReview(review.date)}>{tr("★ Unstar")}</button></div>
              <p>{review.notes}</p>
            </article>)}</div>
          </section>}
          <div className="journal-writing" id="journal">
          <div className="journal-heading">
            <div>
              <p className="eyebrow">{tr("Daily journal")}</p>
              <h2 id="journal-heading">{tr(dateTitle(selectedDate, language))}</h2>
            </div>
            {selectedDate === today && <span className="today-chip">{tr("Today")}</span>}
          </div>
          <div className="day-navigation" aria-label={tr("Choose journal day")}>
            <button type="button" onClick={() => { const day = dateFromKey(selectedDate); day.setDate(day.getDate() - 1); selectDay(day); }} aria-label={tr("Previous day")}>←</button>
            <button type="button" onClick={() => selectDay(new Date())}>{tr("Today")}</button>
            <button type="button" onClick={() => { const day = dateFromKey(selectedDate); day.setDate(day.getDate() + 1); selectDay(day); }} aria-label={tr("Next day")}>→</button>
          </div>

          <div className="review-section">
            <label className="review-label" htmlFor="daily-review">{tr("Thoughts for the day")}</label>
            <textarea id="daily-review" value={reviewText} disabled={reviewBusy} onChange={(event) => setReviewText(event.target.value)} placeholder={tr("What stood out? How did the day feel?")} maxLength={4000} />
            <div className="review-actions"><span role="status" aria-live="polite">{tr(reviewStatus)}</span><div className="review-buttons"><button type="button" className="star-thought-button" aria-pressed={Boolean(selectedReview?.starred)} disabled={reviewBusy || !reviewText.trim()} onClick={() => selectedReview?.starred ? void unstarReview(selectedDate) : void saveReview(true)}>{tr(selectedReview?.starred ? "★ Unstar" : "☆ Star thought")}</button><button type="button" disabled={reviewBusy} onClick={() => void saveReview()}>{tr("Save review")}</button></div></div>
          </div>

          </div>

          <div className="journal-insights">
          <section className="actual-activities" aria-label={tr("What I did that day")}>
            <div className="journal-subheading"><h3>{tr("What I did")}</h3><span>{tr(activities.length)}{tr(" activities")}</span></div>
            {activities.length === 0 ? <p className="quiet-state">{tr("Actual activities from approved voice updates appear here.")}</p> : <ul className="actual-activity-list">{activities.map(a => <li key={a.id} className="actual-activity">
              <strong>{a.title}</strong>
              {(a.start_time || a.end_time || a.duration_min > 0) && <span className="actual-time">
                {tr(a.approximate ? "≈ " : "")}{tr(a.start_time || (a.end_time ? "Until " : ""))}{tr(a.end_time ? `${a.start_time ? "–" : ""}${a.end_time}` : "")}{tr(a.duration_min > 0 ? `${a.start_time || a.end_time ? " · " : ""}${a.duration_min}${a.duration_max > a.duration_min ? `–${a.duration_max}` : ""} min` : "")}
              </span>}
              <span className="actual-completion">{tr(a.completion === "completed" ? "✓ Complete" : a.completion === "session_done" ? "✓ Today" : "In progress")}</span>
            </li>)}</ul>}
          </section>


          </div>
        </section>
      </div>

      <section className="calendar-panel" id="history" aria-labelledby="calendar-heading">
        <div className="calendar-heading">
          <div><p className="eyebrow">{tr("History")}</p><h2 id="calendar-heading">{tr("Your days")}</h2></div>
          <div className="month-navigation">
            <button type="button" onClick={() => setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label={tr("Previous month")}>←</button>
            <strong>{tr(new Intl.DateTimeFormat(language, { month: "long", year: "numeric" }).format(visibleMonth))}</strong>
            <button type="button" onClick={() => setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label={tr("Next month")}>→</button>
          </div>
        </div>
        <div className="calendar-grid" role="group" aria-label={tr(new Intl.DateTimeFormat(language, { month: "long", year: "numeric" }).format(visibleMonth))}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span className="weekday" key={day}>{tr(day)}</span>)}
          {calendarDays.map((day) => {
            const key = dateKey(day);
            const count = historyCounts.get(key) ?? 0;
            const didCount = (legacyDidCounts.get(key) ?? 0) + (slotCounts.get(key) ?? 0);
            const outside = day.getMonth() !== visibleMonth.getMonth();
            return <button className={`calendar-day ${outside ? "is-outside" : ""} ${key === selectedDate ? "is-selected" : ""} ${count ? "has-events" : ""} ${didCount ? "has-did" : ""}`} type="button" aria-pressed={key === selectedDate} aria-current={key === today ? "date" : undefined} key={key} onClick={() => selectDay(day)} aria-label={tr(`${dateTitle(key, language)}, ${count} events, ${didCount} tasks done, about ${didCount * 15} minutes${reviewDates.has(key) ? tr(", review saved") : ""}`)}><span>{tr(day.getDate())}</span><small>{tr(count ? count : "")}</small>{didCount > 0 && <b className="did-count" aria-hidden="true">{tr(didCount)}</b>}{reviewDates.has(key) && <i aria-hidden="true">•</i>}</button>;
          })}
        </div>
        <p className="calendar-note"><span>•</span>{tr(" saved review · ")}<em>4</em>{tr(" events · ")}<b>2</b>{tr(" scheduled tasks recorded (about 15 min each)")}</p>
      </section>
    </main>
  );
}
