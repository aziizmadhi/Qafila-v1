/** An error with an HTTP status and a message that is safe to show players (Arabic). */
export class GameError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const errors = {
  noJourney: () => new GameError(404, "no_journey", "لا توجد قافلة لهذا اليوم بعد. عد لاحقًا!"),
  notFound: () => new GameError(404, "not_found", "لم نجد هذه الرحلة."),
  finished: () => new GameError(409, "finished", "انتهت هذه الرحلة."),
  notServed: () => new GameError(409, "not_served", "هذا السؤال لم يبدأ بعد."),
  alreadyAnswered: () => new GameError(409, "already_answered", "أجبت عن هذا السؤال مسبقًا."),
  notFinished: () => new GameError(403, "not_finished", "أكمل الرحلة أولًا لترى الإجابات."),
  dayOver: () => new GameError(410, "day_over", "انتهى يوم هذه القافلة. يمكنك لعبها في الرحلات المفتوحة."),
  notPast: () => new GameError(400, "not_past", "الرحلات المفتوحة متاحة للأيام الماضية فقط."),
  badInput: (msg = "طلب غير صالح.") => new GameError(400, "bad_input", msg),
  tooFast: () => new GameError(429, "too_fast", "تمهّل قليلًا بين المحاولات."),
  tooManyAttempts: () => new GameError(429, "too_many_attempts", "استنفدت محاولاتك لهذا السؤال."),
  rateLimited: () => new GameError(429, "rate_limited", "تمهّل قليلًا! حاول مرة أخرى بعد لحظات."),
  unauthorized: () => new GameError(401, "unauthorized", "يجب تسجيل الدخول (يكفي الدخول كضيف)."),
};
