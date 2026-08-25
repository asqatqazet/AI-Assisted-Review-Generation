export interface SurveyCopy {
  readonly reviewLabel: string;
  readonly assistantLabel: string;
  readonly openVisit: string;
  readonly invitedVisit: string;
  readonly ask: (business: string) => string;
  readonly acknowledgement: (location: string) => string;
  readonly ratingAsk: string;
  readonly ratingGroupLabel: string;
  readonly chooseRating: string;
  readonly ratingWords: readonly [string, string, string, string, string];
  readonly trust: string;
  readonly generatePath: {
    readonly eyebrow: string;
    readonly title: string;
    readonly body: string;
    readonly cta: string;
  };
  readonly paraphrasePath: {
    readonly eyebrow: string;
    readonly title: string;
    readonly body: string;
    readonly cta: string;
  };
  readonly needRating: string;
  readonly choosePath: string;
  readonly writingPathLabel: string;
  readonly assistanceUnavailable: string;
  readonly notConfiguredHeading: string;
  readonly notConfiguredBody: string;
  readonly startFailed: string;
  readonly verificationEyebrow: string;
  readonly verificationHeading: string;
  readonly verificationLead: string;
  readonly verificationCodeLabel: string;
  readonly verificationCodePlaceholder: string;
  readonly verificationContinue: string;
  readonly verificationNoCode: string;
  readonly verificationReason: string;
  readonly verificationSelectionSaved: (
    rating: number,
    action: "generate" | "paraphrase",
  ) => string;
  readonly verificationFailed: string;
  readonly verificationUnavailableEyebrow: string;
  readonly verificationUnavailableHeading: string;
  readonly verificationUnavailableBody: (business: string) => string;
  readonly verificationBack: string;
  readonly factsEyebrow: string;
  readonly factsHeading: string;
  readonly factsLead: string;
  readonly optionalFactLabel: string;
  readonly optionalFactHelp: (maximum: number) => string;
  readonly confirmAssertion: string;
  readonly assertionConfirmed: string;
  readonly selectionCount: (selected: number, rating: number) => string;
  readonly chooseFormat: string;
  readonly minimumFacts: (minimum: number) => string;
  readonly sourceTextEyebrow: string;
  readonly sourceTextHeading: string;
  readonly sourceTextLead: string;
  readonly sourceTextLabel: string;
  readonly sourceTextHelp: string;
  readonly sourceTextMinimum: string;
  readonly progressSaveConflict: string;
  readonly progressSaveFailed: string;
  readonly formatHeading: string;
  readonly formatLead: string;
  readonly formatLegend: string;
  readonly formatMeta: string;
  readonly formatConstraints: (minimum: number, maximum: number) => string;
  readonly back: string;
  readonly backToSourceText: string;
  readonly writeDraft: string;
  readonly chooseAFormat: string;
  readonly formatChosen: string;
  readonly generatingHeading: string;
  readonly checkingDraft: string;
  readonly progress: (
    phase: "queued" | "generating" | "validating" | "persisting",
    elapsedSeconds: number,
  ) => string;
  readonly stopGeneration: string;
  readonly safeOutputOnly: string;
  readonly resultEyebrow: string;
  readonly resultHeading: string;
  readonly resultLead: string;
  readonly actionLabel: (action: "generate" | "paraphrase") => string;
  readonly editLabel: string;
  readonly characters: (count: number) => string;
  readonly charactersAgainstLimit: (count: number, maximum: number) => string;
  readonly editedByYou: string;
  readonly draftSaving: string;
  readonly draftSaved: string;
  readonly draftSaveConflict: string;
  readonly draftSaveFailed: string;
  readonly formatWarning: (minimum: number, maximum: number) => string;
  readonly provenance: (count: number) => string;
  readonly copy: string;
  readonly readyToCopy: string;
  readonly reworkLabel: string;
  readonly tryAgain: string;
  readonly tryAnotherFormat: string;
  readonly makeShorter: string;
  readonly makeLonger: string;
  readonly wordingInstructionLabel: string;
  readonly wordingInstructionHelp: string;
  readonly applyWordingChange: string;
  readonly changeWhatYouSaid: string;
  readonly reworkNote: string;
  readonly copied: string;
  readonly manualCopy: string;
  readonly dispositionRecording: string;
  readonly dispositionFailed: string;
  readonly copyFootnote: string;
  readonly failureHeading: string;
  readonly failureBody: string;
  readonly cancelledHeading: string;
  readonly cancelledBody: string;
  readonly rateLimitedHeading: string;
  readonly rateLimitedBody: string;
  readonly retryAfter: (seconds: number) => string;
  readonly budgetHeading: string;
  readonly budgetBody: string;
  readonly groundingHeading: string;
  readonly groundingBody: string;
  readonly formatFailureHeading: string;
  readonly formatFailureBody: string;
  readonly changeFacts: string;
  readonly changeFormat: string;
  readonly manualReviewLabel: string;
  readonly retry: string;
  readonly guarded: string;
  readonly doneEyebrow: string;
  readonly doneHeading: string;
  readonly doneLead: string;
  readonly copyAgain: string;
  readonly openDestination: (destination: string) => string;
  readonly backToEdit: string;
  readonly anotherFormat: string;
  readonly noDestination: string;
  readonly privacyControls: string;
  readonly forgetReview: string;
  readonly forgetConfirmation: string;
  readonly confirmForget: string;
  readonly cancelForget: string;
  readonly forgettingReview: string;
  readonly forgetFailed: string;
}

const english: SurveyCopy = {
  reviewLabel: "Review",
  assistantLabel: "Review assistant",
  openVisit: "Open visit",
  invitedVisit: "Invited visit",
  ask: (business) => `Write your review of ${business}`,
  acknowledgement: (location) => `You are at ${location}.`,
  ratingAsk: "How was it?",
  ratingGroupLabel: "Rating, 1 to 5",
  chooseRating: "Choose a rating to continue.",
  ratingWords: ["Poor", "Not good", "Mixed", "Good", "Very good"],
  trust:
    "You supply the facts. Everything on the next screens is a draft you read, change and copy yourself. Nothing is posted anywhere for you.",
  generatePath: {
    eyebrow: "Path one",
    title: "Help me write one",
    body: "Choose the things that actually happened. The draft is built only from those.",
    cta: "Pick what to mention",
  },
  paraphrasePath: {
    eyebrow: "Path two",
    title: "I have written one",
    body: "Paste your own review. Your facts stay exactly as you wrote them; only the wording changes.",
    cta: "Improve my wording",
  },
  needRating:
    "Choose a rating first. It sets the register of the draft, and it is the one thing the assistant will not decide for you.",
  choosePath: "Choose either path to continue.",
  writingPathLabel: "Writing path",
  assistanceUnavailable:
    "Review assistance is not configured for this location right now.",
  notConfiguredHeading: "Writing assistance is not configured",
  notConfiguredBody:
    "No compatible review format is available. You can still write and copy your own review.",
  startFailed: "The review could not be started. Please try again.",
  verificationEyebrow: "Visit confirmation",
  verificationHeading: "Confirm your visit",
  verificationLead:
    "Enter the reference from your booking confirmation or receipt. Your invitation is not used until the visit is confirmed.",
  verificationCodeLabel: "Booking or receipt code",
  verificationCodePlaceholder: "e.g. BS-4471-K",
  verificationContinue: "Continue",
  verificationNoCode: "I don't have a code",
  verificationReason: "Enter the code from your confirmation to continue.",
  verificationSelectionSaved: (rating, action) =>
    `Your ${rating} of 5 rating and ${action === "generate" ? "writing" : "rewording"} choice are saved.`,
  verificationFailed:
    "That visit could not be confirmed. Check the code and try again.",
  verificationUnavailableEyebrow: "Confirmed visits only",
  verificationUnavailableHeading: "Writing help needs a confirmed visit",
  verificationUnavailableBody: (business) =>
    `${business} offers writing help only for visits it can confirm. You can still write, copy and post your own review without assistance.`,
  verificationBack: "Back to the code",
  factsEyebrow: "What happened",
  factsHeading: "What stood out?",
  factsLead:
    "Pick everything that actually happened. The order you pick them is the order they are written in.",
  optionalFactLabel: "Something else that happened (optional)",
  optionalFactHelp: (maximum) =>
    `Write only a fact you personally assert is true. Maximum ${maximum} characters.`,
  confirmAssertion: "Confirm this fact",
  assertionConfirmed: "Fact confirmed.",
  selectionCount: (selected, rating) =>
    `${selected} selected · rating ${rating} of 5`,
  chooseFormat: "Choose a format",
  minimumFacts: (minimum) =>
    `Pick at least ${minimum} things. The assistant will not invent the rest.`,
  sourceTextEyebrow: "Your words",
  sourceTextHeading: "Paste your review",
  sourceTextLead:
    "Your meaning and facts stay fixed. The assistant only changes the wording.",
  sourceTextLabel: "Your review to reword",
  sourceTextHelp: "Enter between 20 and 10,000 characters.",
  sourceTextMinimum: "Enter at least 20 characters to continue.",
  progressSaveConflict:
    "This review changed in another tab. Reload before continuing.",
  progressSaveFailed:
    "Your latest changes could not be saved. Keep this page open and try again.",
  formatHeading: "Pick a format",
  formatLead: "Formats this business has enabled, for what you are doing.",
  formatLegend: "How should your review read?",
  formatMeta: "Review format",
  formatConstraints: (minimum, maximum) => `${minimum}–${maximum} characters`,
  back: "Back",
  backToSourceText: "Back to your review",
  writeDraft: "Write the draft",
  chooseAFormat: "Choose at least one format.",
  formatChosen: "1 format chosen.",
  generatingHeading: "Creating your review",
  checkingDraft: "Checking your draft…",
  progress: (phase, elapsedSeconds) =>
    `${phase[0]?.toUpperCase()}${phase.slice(1)} · ${elapsedSeconds}s`,
  stopGeneration: "Stop waiting",
  safeOutputOnly: "Only supported wording will appear in the result.",
  resultEyebrow: "Your draft",
  resultHeading: "Here it is",
  resultLead:
    "Change anything you like. Nothing leaves this page until you copy it yourself.",
  actionLabel: (action) => (action === "generate" ? "assisted draft" : "reworded"),
  editLabel: "Your draft — edit it freely",
  characters: (count) => `${count} characters`,
  charactersAgainstLimit: (count, maximum) => `${count} / ${maximum} characters`,
  editedByYou: "Edited by you",
  draftSaving: "Saving changes…",
  draftSaved: "Changes saved.",
  draftSaveConflict:
    "This draft changed in another tab. Reload before editing again.",
  draftSaveFailed:
    "Changes could not be saved. Keep this page open and try editing again.",
  formatWarning: (minimum, maximum) =>
    `This format works best between ${minimum} and ${maximum} characters. You can still copy your own final wording.`,
  provenance: (count) =>
    `What this draft is built on (${count} facts, each traceable)`,
  copy: "Copy",
  readyToCopy: "Ready to copy.",
  reworkLabel: "Not quite right?",
  tryAgain: "Write it again",
  tryAnotherFormat: "Try another style",
  makeShorter: "Make it shorter",
  makeLonger: "Make it longer",
  wordingInstructionLabel: "Wording instruction",
  wordingInstructionHelp:
    "Ask only for a presentation change. New facts must be added and confirmed separately.",
  applyWordingChange: "Apply wording change",
  changeWhatYouSaid: "Change what you mentioned",
  reworkNote:
    "Writing it again uses the same points you confirmed, worded differently.",
  copied: "Copied",
  manualCopy: "Select the review text and copy it manually.",
  dispositionRecording: "Copied. Recording completion…",
  dispositionFailed:
    "Copied, but completion could not be recorded. Please try again.",
  copyFootnote:
    "Copying puts the text on your clipboard. Nothing is submitted from here.",
  failureHeading: "We couldn't create a draft",
  failureBody: "No review text was saved. You can try again or write it yourself.",
  cancelledHeading: "Stopped waiting",
  cancelledBody:
    "No partial text was shown. The request may still finish; Try again reconnects to the same request.",
  rateLimitedHeading: "A few too many requests",
  rateLimitedBody:
    "Your choices are still here. Wait a moment, then try the same request again.",
  retryAfter: (seconds) =>
    `Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`,
  budgetHeading: "Writing assistance is temporarily unavailable",
  budgetBody:
    "You can still write, copy and post your review yourself. Account or billing details are never shown here.",
  groundingHeading: "We need a little more detail",
  groundingBody:
    "The assistant could not support a safe draft from the selected facts. Add or change your facts and try again.",
  formatFailureHeading: "The selected format could not be satisfied",
  formatFailureBody:
    "Your choices are still here. Choose different wording or try again later.",
  changeFacts: "Change my facts",
  changeFormat: "Change format",
  manualReviewLabel: "Write your review yourself",
  retry: "Try again",
  guarded: "grounded",
  doneEyebrow: "Ready to post",
  doneHeading: "Your review is ready",
  doneLead:
    "The text is on your clipboard. Open the review platform and submit it yourself when you are ready.",
  copyAgain: "Copy again",
  openDestination: (destination) => `Open ${destination}`,
  backToEdit: "Back to edit",
  anotherFormat: "Write another in a different format",
  noDestination:
    "This location has no posting destination for the selected format. Your review remains available to copy.",
  privacyControls: "Review privacy controls",
  forgetReview: "Forget this review",
  forgetConfirmation:
    "Forget this review on this browser? You will not be able to resume it from this link.",
  confirmForget: "Confirm forget",
  cancelForget: "Keep this review",
  forgettingReview: "Forgetting this review…",
  forgetFailed: "This review could not be forgotten. Please try again.",
};

const german: SurveyCopy = {
  ...english,
  reviewLabel: "Bewertung",
  assistantLabel: "Bewertungsassistent",
  openVisit: "Offener Besuch",
  invitedVisit: "Eingeladener Besuch",
  ask: (business) => `Bewerten Sie Ihren Besuch bei ${business}`,
  acknowledgement: (location) => `Sie sind bei ${location}.`,
  ratingAsk: "Wie war es?",
  ratingGroupLabel: "Bewertung von 1 bis 5",
  chooseRating: "Wählen Sie eine Bewertung, um fortzufahren.",
  ratingWords: ["Schlecht", "Nicht gut", "Gemischt", "Gut", "Sehr gut"],
  trust:
    "Die Fakten kommen von Ihnen. Alles Weitere ist ein Entwurf, den Sie lesen, ändern und selbst kopieren. Nichts wird für Sie veröffentlicht.",
  generatePath: {
    eyebrow: "Weg eins",
    title: "Hilf mir beim Schreiben",
    body: "Wählen Sie aus, was tatsächlich passiert ist. Der Entwurf entsteht nur daraus.",
    cta: "Auswählen, was erwähnt wird",
  },
  paraphrasePath: {
    eyebrow: "Weg zwei",
    title: "Ich habe schon etwas geschrieben",
    body: "Fügen Sie Ihren eigenen Text ein. Ihre Fakten bleiben genau so, wie Sie sie geschrieben haben — nur die Formulierung ändert sich.",
    cta: "Meine Formulierung verbessern",
  },
  needRating:
    "Wählen Sie zuerst eine Bewertung. Sie bestimmt den Ton des Entwurfs, und sie ist das Einzige, was der Assistent nicht für Sie entscheidet.",
  choosePath: "Wählen Sie einen Weg, um fortzufahren.",
  writingPathLabel: "Weg zum Entwurf",
  assistanceUnavailable:
    "Für diesen Standort ist die Bewertungsassistenz derzeit nicht eingerichtet.",
  notConfiguredHeading: "Die Schreibhilfe ist nicht eingerichtet",
  notConfiguredBody:
    "Es ist kein kompatibles Bewertungsformat verfügbar. Sie können Ihre Bewertung weiterhin selbst schreiben und kopieren.",
  startFailed:
    "Die Bewertung konnte nicht gestartet werden. Bitte versuchen Sie es erneut.",
  verificationEyebrow: "Besuch bestätigen",
  verificationHeading: "Bestätigen Sie Ihren Besuch",
  verificationLead:
    "Geben Sie die Referenz aus Ihrer Buchungsbestätigung oder Ihrem Beleg ein. Ihre Einladung wird erst nach erfolgreicher Bestätigung verwendet.",
  verificationCodeLabel: "Buchungs- oder Belegcode",
  verificationCodePlaceholder: "z. B. BS-4471-K",
  verificationContinue: "Weiter",
  verificationNoCode: "Ich habe keinen Code",
  verificationReason:
    "Geben Sie den Code aus Ihrer Bestätigung ein, um fortzufahren.",
  verificationSelectionSaved: (rating, action) =>
    `Ihre Bewertung ${rating} von 5 und die Auswahl „${action === "generate" ? "Schreibhilfe" : "Umformulieren"}“ sind gespeichert.`,
  verificationFailed:
    "Der Besuch konnte nicht bestätigt werden. Prüfen Sie den Code und versuchen Sie es erneut.",
  verificationUnavailableEyebrow: "Nur bestätigte Besuche",
  verificationUnavailableHeading:
    "Die Schreibhilfe benötigt einen bestätigten Besuch",
  verificationUnavailableBody: (business) =>
    `${business} bietet Schreibhilfe nur für bestätigte Besuche an. Sie können Ihre Bewertung weiterhin ohne Hilfe selbst schreiben, kopieren und veröffentlichen.`,
  verificationBack: "Zurück zum Code",
  factsEyebrow: "Was passiert ist",
  factsHeading: "Was ist Ihnen aufgefallen?",
  factsLead:
    "Wählen Sie alles, was tatsächlich passiert ist. Die Reihenfolge Ihrer Auswahl ist die Reihenfolge im Text.",
  optionalFactLabel: "Etwas anderes, das passiert ist (optional)",
  optionalFactHelp: (maximum) =>
    `Schreiben Sie nur einen Fakt, dessen Wahrheit Sie selbst bestätigen. Maximal ${maximum} Zeichen.`,
  confirmAssertion: "Diesen Fakt bestätigen",
  assertionConfirmed: "Fakt bestätigt.",
  selectionCount: (selected, rating) =>
    `${selected} ausgewählt · Bewertung ${rating} von 5`,
  chooseFormat: "Format wählen",
  minimumFacts: (minimum) =>
    `Wählen Sie mindestens ${minimum} Punkte. Der Assistent erfindet den Rest nicht.`,
  sourceTextEyebrow: "Ihre Worte",
  sourceTextHeading: "Bewertung einfügen",
  sourceTextLead:
    "Ihre Aussage und Fakten bleiben unverändert. Der Assistent ändert nur die Formulierung.",
  sourceTextLabel: "Ihre umzuformulierende Bewertung",
  sourceTextHelp: "Geben Sie zwischen 20 und 10.000 Zeichen ein.",
  sourceTextMinimum: "Geben Sie mindestens 20 Zeichen ein, um fortzufahren.",
  progressSaveConflict:
    "Diese Bewertung wurde in einem anderen Tab geändert. Laden Sie die Seite neu, bevor Sie fortfahren.",
  progressSaveFailed:
    "Ihre letzten Änderungen konnten nicht gespeichert werden. Lassen Sie diese Seite geöffnet und versuchen Sie es erneut.",
  formatHeading: "Format wählen",
  formatLead: "Formate, die dieses Haus für diese Aktion freigegeben hat.",
  formatLegend: "Wie soll Ihre Bewertung klingen?",
  formatMeta: "Bewertungsformat",
  formatConstraints: (minimum, maximum) => `${minimum}–${maximum} Zeichen`,
  back: "Zurück",
  backToSourceText: "Zurück zu Ihrer Bewertung",
  writeDraft: "Entwurf schreiben",
  chooseAFormat: "Wählen Sie mindestens ein Format.",
  formatChosen: "1 Format ausgewählt.",
  generatingHeading: "Ihre Bewertung wird erstellt",
  checkingDraft: "Entwurf wird geprüft…",
  progress: (phase, elapsedSeconds) => {
    const phases = {
      queued: "Wartet",
      generating: "Wird erstellt",
      validating: "Wird geprüft",
      persisting: "Wird gespeichert",
    } as const;
    return `${phases[phase]} · ${elapsedSeconds}s`;
  },
  stopGeneration: "Warten beenden",
  safeOutputOnly: "Im Ergebnis erscheinen nur belegte Formulierungen.",
  resultEyebrow: "Ihr Entwurf",
  resultHeading: "Hier ist er",
  resultLead:
    "Ändern Sie alles, was Sie möchten. Nichts verlässt diese Seite, bis Sie es selbst kopieren.",
  actionLabel: (action) =>
    action === "generate" ? "Schreibentwurf" : "neu formuliert",
  editLabel: "Ihr Entwurf — frei bearbeitbar",
  characters: (count) => `${count} Zeichen`,
  charactersAgainstLimit: (count, maximum) => `${count} / ${maximum} Zeichen`,
  editedByYou: "Von Ihnen bearbeitet",
  draftSaving: "Änderungen werden gespeichert…",
  draftSaved: "Änderungen gespeichert.",
  draftSaveConflict:
    "Dieser Entwurf wurde in einem anderen Tab geändert. Laden Sie die Seite neu, bevor Sie weiter bearbeiten.",
  draftSaveFailed:
    "Änderungen konnten nicht gespeichert werden. Lassen Sie diese Seite geöffnet und bearbeiten Sie den Text erneut.",
  formatWarning: (minimum, maximum) =>
    `Dieses Format funktioniert am besten mit ${minimum} bis ${maximum} Zeichen. Ihren eigenen finalen Text können Sie trotzdem kopieren.`,
  provenance: (count) =>
    `Worauf dieser Entwurf beruht (${count} belegte Fakten)`,
  copy: "Kopieren",
  readyToCopy: "Bereit zum Kopieren.",
  reworkLabel: "Nicht ganz passend?",
  tryAgain: "Neu schreiben lassen",
  tryAnotherFormat: "Anderen Stil versuchen",
  makeShorter: "Kürzer formulieren",
  makeLonger: "Ausführlicher formulieren",
  wordingInstructionLabel: "Anweisung zur Formulierung",
  wordingInstructionHelp:
    "Bitten Sie nur um eine sprachliche Änderung. Neue Fakten müssen separat ergänzt und bestätigt werden.",
  applyWordingChange: "Formulierung ändern",
  changeWhatYouSaid: "Angaben ändern",
  reworkNote:
    "Beim Neuschreiben werden dieselben bestätigten Punkte anders formuliert.",
  copied: "Kopiert",
  manualCopy: "Markieren und kopieren Sie den Text manuell.",
  dispositionRecording: "Kopiert. Abschluss wird gespeichert…",
  dispositionFailed:
    "Kopiert, aber der Abschluss konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.",
  copyFootnote:
    "Beim Kopieren wird der Text in die Zwischenablage gelegt. Von hier wird nichts veröffentlicht.",
  failureHeading: "Der Entwurf konnte nicht erstellt werden",
  failureBody:
    "Es wurde kein Bewertungstext gespeichert. Sie können es erneut versuchen oder selbst schreiben.",
  cancelledHeading: "Warten beendet",
  cancelledBody:
    "Es wurde kein Teiltext angezeigt. Die Anfrage kann noch abgeschlossen werden; „Erneut versuchen“ verbindet sich wieder mit derselben Anfrage.",
  rateLimitedHeading: "Zu viele Anfragen in kurzer Zeit",
  rateLimitedBody:
    "Ihre Auswahl bleibt erhalten. Warten Sie einen Moment und versuchen Sie dieselbe Anfrage erneut.",
  retryAfter: (seconds) =>
    `Erneut versuchen in ${seconds} ${seconds === 1 ? "Sekunde" : "Sekunden"}.`,
  budgetHeading: "Die Schreibhilfe ist vorübergehend nicht verfügbar",
  budgetBody:
    "Sie können Ihre Bewertung weiterhin selbst schreiben, kopieren und veröffentlichen. Konto- oder Abrechnungsdetails werden hier nicht angezeigt.",
  groundingHeading: "Wir brauchen etwas mehr Information",
  groundingBody:
    "Aus den ausgewählten Fakten konnte kein sicher belegter Entwurf entstehen. Ergänzen oder ändern Sie Ihre Fakten und versuchen Sie es erneut.",
  formatFailureHeading: "Das ausgewählte Format konnte nicht erfüllt werden",
  formatFailureBody:
    "Ihre Auswahl bleibt erhalten. Wählen Sie eine andere Formulierung oder versuchen Sie es später erneut.",
  changeFacts: "Fakten ändern",
  changeFormat: "Format ändern",
  manualReviewLabel: "Bewertung selbst schreiben",
  retry: "Erneut versuchen",
  guarded: "belegt",
  doneEyebrow: "Bereit zum Veröffentlichen",
  doneHeading: "Ihre Bewertung ist bereit",
  doneLead:
    "Der Text ist in Ihrer Zwischenablage. Öffnen Sie die Bewertungsplattform und veröffentlichen Sie ihn selbst, wenn Sie bereit sind.",
  copyAgain: "Erneut kopieren",
  openDestination: (destination) => `${destination} öffnen`,
  backToEdit: "Weiter bearbeiten",
  anotherFormat: "Weitere Bewertung in einem anderen Format",
  noDestination:
    "Für das ausgewählte Format ist an diesem Standort kein Ziel hinterlegt. Ihre Bewertung kann weiterhin kopiert werden.",
  privacyControls: "Datenschutzeinstellungen der Bewertung",
  forgetReview: "Diese Bewertung vergessen",
  forgetConfirmation:
    "Diese Bewertung in diesem Browser vergessen? Sie kann danach über diesen Link nicht fortgesetzt werden.",
  confirmForget: "Vergessen bestätigen",
  cancelForget: "Bewertung behalten",
  forgettingReview: "Bewertung wird vergessen…",
  forgetFailed:
    "Die Bewertung konnte nicht vergessen werden. Bitte versuchen Sie es erneut.",
};

export function getSurveyCopy(locale: string): SurveyCopy {
  return locale === "de-DE" ? german : english;
}
