/**
 * A retake keeps the saved scores and transcript until the user accepts
 * the new results. Writing the Mirror draft before that would replace the
 * earlier transcript on the first AI reply.
 */
export function shouldPersistInterviewDraft(input: {
  inProgress: boolean;
  interviewsCompleted: number;
}): boolean {
  return !(input.inProgress && input.interviewsCompleted > 0);
}
