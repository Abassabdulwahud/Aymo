import { createContext, ReactNode, useContext, useMemo, useState } from "react";

export type LanguageCode = "en" | "ar" | "fr" | "es" | "de" | "ha";

type TranslationKey =
  | "settings.title"
  | "settings.back"
  | "settings.theme"
  | "settings.language"
  | "settings.languageLabel"
  | "settings.account"
  | "settings.name"
  | "settings.email"
  | "settings.logout"
  | "settings.profileTitle"
  | "app.settings"
  | "app.light"
  | "app.dark"
  | "language.en"
  | "language.ar"
  | "language.fr"
  | "language.es"
  | "language.de"
  | "language.ha"
  | "home.title"
  | "home.createNote"
  | "home.creating"
  | "home.searchPlaceholder"
  | "app.back"
  | "app.share"
  | "app.save"
  | "home.tags"
  | "home.startWriting"
  | "home.words"
  | "home.pin"
  | "home.unpin"
  | "home.delete"
  | "home.emptyNotes"
  | "writing.title"
  | "writing.space"
  | "writing.placeholder"
  | "writing.stopRecording"
  | "writing.recordVoice"
  | "assistant.title"
  | "assistant.search"
  | "assistant.askPlaceholder"
  | "assistant.send"
  | "assistant.sending"
  | "assistant.voice"
  | "auth.lightMode"
  | "auth.darkMode"
  | "auth.welcomeBack"
  | "auth.createAccount"
  | "auth.chooseNewPassword"
  | "auth.fullName"
  | "auth.email"
  | "auth.password"
  | "auth.confirmPassword"
  | "auth.pleaseWait"
  | "auth.login"
  | "auth.signup"
  | "auth.resetPassword"
  | "auth.forgotPassword"
  | "auth.noAccount"
  | "auth.haveAccount"
  | "auth.remembered"
  | "auth.signupCta"
  | "auth.loginCta"
  | "auth.or"
  | "auth.show"
  | "auth.hide"
  | "tab.uploads"
  | "tab.viewer"
  | "tab.assistant"
  | "uploads.count"
  | "uploads.addLink"
  | "uploads.dropHint"
  | "uploads.supported"
  | "uploads.added"
  | "uploads.remove"
  | "uploads.empty"
  | "viewer.openSource"
  | "viewer.openLink"
  | "viewer.openDocument"
  | "viewer.collapse"
  | "viewer.expand"
  | "viewer.selectFile"
  | "viewer.noLink"
  | "viewer.extraction"
  | "viewer.documentInlineUnsupported"
  | "viewer.previewLoadFailed"
  | "app.shareCopied"
  | "app.addLinkPrompt"
  | "app.authChecking"
  | "app.sessionRestoring"
  | "app.sessionUserFallback"
  | "app.noteUntitled"
  | "app.noteUntagged"
  | "app.relativeJustNow"
  | "app.firstNotePrompt"
  | "app.newNoteError"
  | "app.deleteNoteError"
  | "app.uploadRemoveError"
  | "record.ready"
  | "record.finishing"
  | "record.unavailable"
  | "record.connectInternet"
  | "record.micRequired"
  | "record.recording"
  | "record.stopped"
  | "record.stoppedAdded"
  | "record.voiceStopped"
  | "auth.passwordsMismatch"
  | "auth.resetLinkInvalid"
  | "auth.authFailed"
  | "auth.googleLoading"
  | "auth.googleTokenMissing"
  | "auth.googleFailed"
  | "auth.googleLoadFailed"
  | "auth.googleStillLoading"
  | "auth.appleNotReady"
  | "auth.appleInitFailed"
  | "auth.appleTokenMissing"
  | "auth.appleFailed"
  | "auth.enterEmailFirst"
  | "auth.resetStartFailed"
  | "assistant.filterAll"
  | "assistant.filterMine"
  | "assistant.filterReplies";

const FALLBACK_LANGUAGE: LanguageCode = "en";

const LANGUAGE_NAME_TO_CODE: Record<string, LanguageCode> = {
  english: "en",
  arabic: "ar",
  french: "fr",
  spanish: "es",
  german: "de",
  hausa: "ha",
  العربية: "ar",
  francais: "fr",
  "français": "fr",
  espanol: "es",
  español: "es",
  deutsch: "de",
};

const CODE_TO_LANGUAGE_NAME: Record<LanguageCode, string> = {
  en: "English",
  ar: "Arabic",
  fr: "French",
  es: "Spanish",
  de: "German",
  ha: "Hausa",
};

const TRANSLATIONS: Record<LanguageCode, Partial<Record<TranslationKey, string>>> = {
  en: {
    "settings.title": "Settings",
    "settings.back": "Back",
    "settings.theme": "Theme",
    "settings.language": "Language",
    "settings.languageLabel": "Preferred language",
    "settings.account": "Account",
    "settings.name": "Name",
    "settings.email": "Email",
    "settings.logout": "Logout",
    "settings.profileTitle": "Profile",
    "app.settings": "Settings",
    "app.light": "Light",
    "app.dark": "Dark",
    "language.en": "English",
    "language.ar": "Arabic",
    "language.fr": "French",
    "language.es": "Spanish",
    "language.de": "German",
    "language.ha": "Hausa",
    "home.title": "My Notes",
    "home.createNote": "Create Note",
    "home.creating": "Creating...",
    "home.searchPlaceholder": "Search notes by title or content",
    "app.back": "Back",
    "app.share": "Share",
    "app.save": "Save",
    "home.tags": "Tags",
    "home.startWriting": "Start writing your note...",
    "home.words": "words",
    "home.pin": "Pin",
    "home.unpin": "Unpin",
    "home.delete": "Delete",
    "home.emptyNotes": "No notes found.",
    "writing.title": "Title",
    "writing.space": "Writing Space",
    "writing.placeholder": "Start writing your note...",
    "writing.stopRecording": "Stop Recording",
    "writing.recordVoice": "Record Voice",
    "assistant.title": "Note Conversation",
    "assistant.search": "Search this conversation",
    "assistant.askPlaceholder": "Ask AI about this note or its uploads",
    "assistant.send": "Send",
    "assistant.sending": "Sending...",
    "assistant.voice": "Voice",
    "auth.lightMode": "Light Mode",
    "auth.darkMode": "Dark Mode",
    "auth.welcomeBack": "Welcome back",
    "auth.createAccount": "Create your account",
    "auth.chooseNewPassword": "Choose a new password",
    "auth.fullName": "Full name",
    "auth.email": "Email",
    "auth.password": "Password",
    "auth.confirmPassword": "Confirm password",
    "auth.pleaseWait": "Please wait...",
    "auth.login": "Log In",
    "auth.signup": "Sign Up",
    "auth.resetPassword": "Reset Password",
    "auth.forgotPassword": "Forgot password?",
    "auth.noAccount": "Don't have an account?",
    "auth.haveAccount": "Already have an account?",
    "auth.remembered": "Remembered it?",
    "auth.signupCta": "Sign up",
    "auth.loginCta": "Log in",
    "auth.or": "OR",
    "auth.show": "Show",
    "auth.hide": "Hide",
    "tab.uploads": "Uploads",
    "tab.viewer": "File Viewer",
    "tab.assistant": "AI Assistant",
    "uploads.count": "items attached",
    "uploads.addLink": "Add Link",
    "uploads.dropHint": "Drag and drop files here, or click to browse.",
    "uploads.supported": "Supports images, PDFs, documents, video, audio, and links.",
    "uploads.added": "Added",
    "uploads.remove": "Remove",
    "uploads.empty": "No uploads yet. Add a file or link to get started.",
    "viewer.openSource": "Open Source",
    "viewer.openLink": "Open Link",
    "viewer.openDocument": "Open Document",
    "viewer.collapse": "Collapse",
    "viewer.expand": "Expand",
    "viewer.selectFile": "Select a file from the Uploads tab to open it in the viewer.",
    "viewer.noLink": "No link available.",
    "viewer.extraction": "Extraction",
    "viewer.documentInlineUnsupported": "Word, PowerPoint, and spreadsheet files cannot always be rendered inline in the browser on localhost.",
    "viewer.previewLoadFailed": "Inline preview could not be loaded. Use Open Source instead.",
    "app.shareCopied": "Share link copied.",
    "app.addLinkPrompt": "Paste a URL to attach to this note:",
    "app.authChecking": "Checking session...",
    "app.sessionRestoring": "Restoring your session...",
    "app.sessionUserFallback": "AYMO User",
    "app.noteUntitled": "Untitled Note",
    "app.noteUntagged": "untagged",
    "app.relativeJustNow": "Just now",
    "app.firstNotePrompt": "Create your first note to start writing.",
    "app.newNoteError": "A new note could not be created right now.",
    "app.deleteNoteError": "This note could not be deleted right now.",
    "app.uploadRemoveError": "This upload could not be removed right now.",
    "record.ready": "Voice capture is ready.",
    "record.finishing": "Finishing transcription...",
    "record.unavailable": "Voice transcription unavailable.",
    "record.connectInternet": "Connect to the internet to start recording.",
    "record.micRequired": "Microphone access is required.",
    "record.recording": "Recording...",
    "record.stopped": "Recording stopped.",
    "record.stoppedAdded": "Recording stopped. Transcript added to your note.",
    "record.voiceStopped": "Voice transcription stopped.",
    "auth.passwordsMismatch": "Passwords do not match.",
    "auth.resetLinkInvalid": "Password reset link is missing or invalid.",
    "auth.authFailed": "Authentication failed.",
    "auth.googleLoading": "Loading Google sign-in...",
    "auth.googleTokenMissing": "Google sign-in did not return a usable identity token.",
    "auth.googleFailed": "Google authentication failed.",
    "auth.googleLoadFailed": "Google sign-in could not load in this browser right now.",
    "auth.googleStillLoading": "Google sign-in is still loading.",
    "auth.appleNotReady": "Apple sign-in is not ready in this environment.",
    "auth.appleInitFailed": "Apple sign-in could not initialize in this browser.",
    "auth.appleTokenMissing": "Apple sign-in did not return an identity token.",
    "auth.appleFailed": "Apple authentication failed.",
    "auth.enterEmailFirst": "Enter your email first so we know which account to reset.",
    "auth.resetStartFailed": "Could not start password reset.",
    "assistant.filterAll": "All",
    "assistant.filterMine": "My Messages",
    "assistant.filterReplies": "AI Replies",
  },
  ar: {
    "settings.title": "الإعدادات",
    "settings.back": "رجوع",
    "settings.theme": "السمة",
    "settings.language": "اللغة",
    "settings.languageLabel": "اللغة المفضلة",
    "settings.account": "الحساب",
    "settings.name": "الاسم",
    "settings.email": "البريد الإلكتروني",
    "settings.logout": "تسجيل الخروج",
    "settings.profileTitle": "الملف الشخصي",
    "app.settings": "الإعدادات",
    "app.light": "فاتح",
    "app.dark": "داكن",
    "language.en": "الإنجليزية",
    "language.ar": "العربية",
    "language.fr": "الفرنسية",
    "language.es": "الإسبانية",
    "language.de": "الألمانية",
    "home.title": "ملاحظاتي",
    "home.createNote": "إنشاء ملاحظة",
    "home.creating": "جار الإنشاء...",
    "home.searchPlaceholder": "ابحث في الملاحظات بالعنوان أو المحتوى",
    "app.back": "رجوع",
    "app.share": "مشاركة",
    "app.save": "حفظ",
    "home.tags": "الوسوم",
    "home.startWriting": "ابدأ كتابة ملاحظتك...",
    "home.words": "كلمات",
    "home.pin": "تثبيت",
    "home.unpin": "إلغاء التثبيت",
    "home.delete": "حذف",
    "home.emptyNotes": "لم يتم العثور على ملاحظات.",
    "writing.title": "العنوان",
    "writing.space": "مساحة الكتابة",
    "writing.placeholder": "ابدأ كتابة ملاحظتك...",
    "writing.stopRecording": "إيقاف التسجيل",
    "writing.recordVoice": "تسجيل الصوت",
    "assistant.title": "محادثة الملاحظة",
    "assistant.search": "ابحث في هذه المحادثة",
    "assistant.askPlaceholder": "اسأل الذكاء الاصطناعي عن هذه الملاحظة أو مرفقاتها",
    "assistant.send": "إرسال",
    "assistant.sending": "جارٍ الإرسال...",
    "assistant.voice": "صوت",
    "auth.lightMode": "الوضع الفاتح",
    "auth.darkMode": "الوضع الداكن",
    "auth.welcomeBack": "مرحبًا بعودتك",
    "auth.createAccount": "أنشئ حسابك",
    "auth.chooseNewPassword": "اختر كلمة مرور جديدة",
    "auth.fullName": "الاسم الكامل",
    "auth.email": "البريد الإلكتروني",
    "auth.password": "كلمة المرور",
    "auth.confirmPassword": "تأكيد كلمة المرور",
    "auth.pleaseWait": "يرجى الانتظار...",
    "auth.login": "تسجيل الدخول",
    "auth.signup": "إنشاء حساب",
    "auth.resetPassword": "إعادة تعيين كلمة المرور",
    "auth.forgotPassword": "هل نسيت كلمة المرور؟",
    "auth.noAccount": "ليس لديك حساب؟",
    "auth.haveAccount": "لديك حساب بالفعل؟",
    "auth.remembered": "تذكرت كلمة المرور؟",
    "auth.signupCta": "إنشاء حساب",
    "auth.loginCta": "تسجيل الدخول",
    "auth.or": "أو",
    "auth.show": "إظهار",
    "auth.hide": "إخفاء",
    "tab.uploads": "الملفات المرفوعة",
    "tab.viewer": "عارض الملفات",
    "tab.assistant": "المساعد الذكي",
    "uploads.count": "عنصرًا مرفقًا",
    "uploads.addLink": "إضافة رابط",
    "uploads.dropHint": "اسحب الملفات وأفلتها هنا، أو انقر للتصفح.",
    "uploads.supported": "يدعم الصور وPDF والمستندات والفيديو والصوت والروابط.",
    "uploads.added": "أضيف",
    "uploads.remove": "إزالة",
    "uploads.empty": "لا توجد ملفات بعد. أضف ملفًا أو رابطًا للبدء.",
    "viewer.openSource": "فتح المصدر",
    "viewer.openLink": "فتح الرابط",
    "viewer.openDocument": "فتح المستند",
    "viewer.collapse": "طي",
    "viewer.expand": "توسيع",
    "viewer.selectFile": "اختر ملفًا من تبويب المرفقات لفتحه في العارض.",
    "viewer.noLink": "لا يوجد رابط متاح.",
    "viewer.extraction": "الاستخراج",
    "viewer.documentInlineUnsupported": "لا يمكن دائمًا عرض ملفات Word وPowerPoint والجداول داخل المتصفح على localhost.",
    "viewer.previewLoadFailed": "تعذر تحميل المعاينة داخل الصفحة. استخدم فتح المصدر بدلًا من ذلك.",
    "app.shareCopied": "تم نسخ رابط المشاركة.",
    "app.addLinkPrompt": "الصق رابط URL لإرفاقه بهذه الملاحظة:",
    "app.authChecking": "جارٍ التحقق من الجلسة...",
    "app.sessionRestoring": "جارٍ استعادة جلستك...",
    "app.sessionUserFallback": "مستخدم AYMO",
    "app.noteUntitled": "ملاحظة بلا عنوان",
    "app.noteUntagged": "بدون وسم",
    "app.relativeJustNow": "الآن",
    "app.firstNotePrompt": "أنشئ ملاحظتك الأولى لبدء الكتابة.",
    "app.newNoteError": "تعذر إنشاء ملاحظة جديدة الآن.",
    "app.deleteNoteError": "تعذر حذف هذه الملاحظة الآن.",
    "app.uploadRemoveError": "تعذر إزالة هذا المرفق الآن.",
    "record.ready": "تسجيل الصوت جاهز.",
    "record.finishing": "جارٍ إنهاء التفريغ...",
    "record.unavailable": "التفريغ الصوتي غير متاح.",
    "record.connectInternet": "اتصل بالإنترنت لبدء التسجيل.",
    "record.micRequired": "يلزم الوصول إلى الميكروفون.",
    "record.recording": "جارٍ التسجيل...",
    "record.stopped": "تم إيقاف التسجيل.",
    "record.stoppedAdded": "تم إيقاف التسجيل وإضافة النص إلى ملاحظتك.",
    "record.voiceStopped": "تم إيقاف التفريغ الصوتي.",
    "auth.passwordsMismatch": "كلمتا المرور غير متطابقتين.",
    "auth.resetLinkInvalid": "رابط إعادة التعيين مفقود أو غير صالح.",
    "auth.authFailed": "فشلت المصادقة.",
    "auth.googleLoading": "جارٍ تحميل تسجيل الدخول عبر Google...",
    "auth.googleTokenMissing": "لم يُرجع Google رمز هوية صالحًا.",
    "auth.googleFailed": "فشل تسجيل الدخول عبر Google.",
    "auth.googleLoadFailed": "تعذر تحميل تسجيل Google في هذا المتصفح الآن.",
    "auth.googleStillLoading": "لا يزال تسجيل Google قيد التحميل.",
    "auth.appleNotReady": "تسجيل Apple غير جاهز في هذه البيئة.",
    "auth.appleInitFailed": "تعذر تهيئة تسجيل Apple في هذا المتصفح.",
    "auth.appleTokenMissing": "لم يُرجع Apple رمز هوية.",
    "auth.appleFailed": "فشل تسجيل Apple.",
    "auth.enterEmailFirst": "أدخل بريدك الإلكتروني أولًا لمعرفة الحساب المطلوب إعادة تعيينه.",
    "auth.resetStartFailed": "تعذر بدء إعادة تعيين كلمة المرور.",
    "assistant.filterAll": "الكل",
    "assistant.filterMine": "رسائلي",
    "assistant.filterReplies": "ردود الذكاء الاصطناعي",
  },
  fr: {
    "settings.title": "Paramètres",
    "settings.back": "Retour",
    "settings.theme": "Thème",
    "settings.language": "Langue",
    "settings.languageLabel": "Langue préférée",
    "settings.account": "Compte",
    "settings.name": "Nom",
    "settings.email": "E-mail",
    "settings.logout": "Déconnexion",
    "settings.profileTitle": "Profil",
    "app.settings": "Paramètres",
    "app.light": "Clair",
    "app.dark": "Sombre",
    "language.en": "Anglais",
    "language.ar": "Arabe",
    "language.fr": "Français",
    "language.es": "Espagnol",
    "language.de": "Allemand",
    "home.title": "Mes notes",
    "home.createNote": "Créer une note",
    "home.creating": "Création...",
    "home.searchPlaceholder": "Rechercher des notes par titre ou contenu",
    "app.back": "Retour",
    "app.share": "Partager",
    "app.save": "Enregistrer",
    "home.tags": "Étiquettes",
    "home.startWriting": "Commencez à écrire votre note...",
    "home.words": "mots",
    "home.pin": "Épingler",
    "home.unpin": "Désépingler",
    "home.delete": "Supprimer",
    "home.emptyNotes": "Aucune note trouvée.",
    "writing.title": "Titre",
    "writing.space": "Espace d'écriture",
    "writing.placeholder": "Commencez à écrire votre note...",
    "writing.stopRecording": "Arrêter l'enregistrement",
    "writing.recordVoice": "Enregistrer la voix",
    "assistant.title": "Conversation de la note",
    "assistant.search": "Rechercher dans cette conversation",
    "assistant.askPlaceholder": "Demandez à l'IA à propos de cette note ou de ses fichiers",
    "assistant.send": "Envoyer",
    "assistant.sending": "Envoi...",
    "assistant.voice": "Voix",
    "auth.lightMode": "Mode clair",
    "auth.darkMode": "Mode sombre",
    "auth.welcomeBack": "Bon retour",
    "auth.createAccount": "Créez votre compte",
    "auth.chooseNewPassword": "Choisissez un nouveau mot de passe",
    "auth.fullName": "Nom complet",
    "auth.email": "E-mail",
    "auth.password": "Mot de passe",
    "auth.confirmPassword": "Confirmer le mot de passe",
    "auth.pleaseWait": "Veuillez patienter...",
    "auth.login": "Se connecter",
    "auth.signup": "S'inscrire",
    "auth.resetPassword": "Réinitialiser le mot de passe",
    "auth.forgotPassword": "Mot de passe oublié ?",
    "auth.noAccount": "Vous n'avez pas de compte ?",
    "auth.haveAccount": "Vous avez déjà un compte ?",
    "auth.remembered": "Vous vous en souvenez ?",
    "auth.signupCta": "S'inscrire",
    "auth.loginCta": "Se connecter",
    "auth.or": "OU",
    "auth.show": "Afficher",
    "auth.hide": "Masquer",
    "tab.uploads": "Fichiers",
    "tab.viewer": "Visionneuse",
    "tab.assistant": "Assistant IA",
    "uploads.count": "éléments joints",
    "uploads.addLink": "Ajouter un lien",
    "uploads.dropHint": "Glissez-déposez des fichiers ici, ou cliquez pour parcourir.",
    "uploads.supported": "Prend en charge images, PDF, documents, vidéo, audio et liens.",
    "uploads.added": "Ajouté",
    "uploads.remove": "Supprimer",
    "uploads.empty": "Aucun fichier pour le moment. Ajoutez un fichier ou un lien pour commencer.",
    "viewer.openSource": "Ouvrir la source",
    "viewer.openLink": "Ouvrir le lien",
    "viewer.openDocument": "Ouvrir le document",
    "viewer.collapse": "Réduire",
    "viewer.expand": "Développer",
    "viewer.selectFile": "Sélectionnez un fichier depuis l'onglet Fichiers pour l'ouvrir dans la visionneuse.",
    "viewer.noLink": "Aucun lien disponible.",
    "viewer.extraction": "Extraction",
    "viewer.documentInlineUnsupported": "Les fichiers Word, PowerPoint et tableurs ne peuvent pas toujours être affichés inline dans le navigateur en localhost.",
    "viewer.previewLoadFailed": "La prévisualisation inline n'a pas pu être chargée. Utilisez Ouvrir la source à la place.",
    "app.shareCopied": "Lien de partage copié.",
    "app.addLinkPrompt": "Collez une URL à joindre à cette note :",
    "app.authChecking": "Vérification de la session...",
    "app.sessionRestoring": "Restauration de votre session...",
    "app.sessionUserFallback": "Utilisateur AYMO",
    "app.noteUntitled": "Note sans titre",
    "app.noteUntagged": "sans-étiquette",
    "app.relativeJustNow": "À l'instant",
    "app.firstNotePrompt": "Créez votre première note pour commencer à écrire.",
    "app.newNoteError": "Impossible de créer une nouvelle note pour le moment.",
    "app.deleteNoteError": "Impossible de supprimer cette note pour le moment.",
    "app.uploadRemoveError": "Impossible de supprimer ce fichier pour le moment.",
    "record.ready": "La capture vocale est prête.",
    "record.finishing": "Finalisation de la transcription...",
    "record.unavailable": "Transcription vocale indisponible.",
    "record.connectInternet": "Connectez-vous à internet pour démarrer l'enregistrement.",
    "record.micRequired": "L'accès au microphone est requis.",
    "record.recording": "Enregistrement...",
    "record.stopped": "Enregistrement arrêté.",
    "record.stoppedAdded": "Enregistrement arrêté. Transcription ajoutée à votre note.",
    "record.voiceStopped": "Transcription vocale arrêtée.",
    "auth.passwordsMismatch": "Les mots de passe ne correspondent pas.",
    "auth.resetLinkInvalid": "Le lien de réinitialisation est manquant ou invalide.",
    "auth.authFailed": "Échec de l'authentification.",
    "auth.googleLoading": "Chargement de la connexion Google...",
    "auth.googleTokenMissing": "Google n'a pas renvoyé de jeton d'identité exploitable.",
    "auth.googleFailed": "Échec de l'authentification Google.",
    "auth.googleLoadFailed": "La connexion Google n'a pas pu être chargée dans ce navigateur pour le moment.",
    "auth.googleStillLoading": "La connexion Google est toujours en cours de chargement.",
    "auth.appleNotReady": "La connexion Apple n'est pas prête dans cet environnement.",
    "auth.appleInitFailed": "La connexion Apple n'a pas pu être initialisée dans ce navigateur.",
    "auth.appleTokenMissing": "Apple n'a pas renvoyé de jeton d'identité.",
    "auth.appleFailed": "Échec de l'authentification Apple.",
    "auth.enterEmailFirst": "Entrez d'abord votre e-mail pour identifier le compte à réinitialiser.",
    "auth.resetStartFailed": "Impossible de démarrer la réinitialisation du mot de passe.",
    "assistant.filterAll": "Tous",
    "assistant.filterMine": "Mes messages",
    "assistant.filterReplies": "Réponses IA",
  },
  es: {
    "settings.title": "Configuración",
    "settings.back": "Volver",
    "settings.theme": "Tema",
    "settings.language": "Idioma",
    "settings.languageLabel": "Idioma preferido",
    "settings.account": "Cuenta",
    "settings.name": "Nombre",
    "settings.email": "Correo electrónico",
    "settings.logout": "Cerrar sesión",
    "settings.profileTitle": "Perfil",
    "app.settings": "Configuración",
    "app.light": "Claro",
    "app.dark": "Oscuro",
    "language.en": "Inglés",
    "language.ar": "Árabe",
    "language.fr": "Francés",
    "language.es": "Español",
    "language.de": "Alemán",
    "home.title": "Mis notas",
    "home.createNote": "Crear nota",
    "home.creating": "Creando...",
    "home.searchPlaceholder": "Buscar notas por título o contenido",
    "app.back": "Volver",
    "app.share": "Compartir",
    "app.save": "Guardar",
    "home.tags": "Etiquetas",
    "home.startWriting": "Empieza a escribir tu nota...",
    "home.words": "palabras",
    "home.pin": "Fijar",
    "home.unpin": "Desfijar",
    "home.delete": "Eliminar",
    "home.emptyNotes": "No se encontraron notas.",
    "writing.title": "Título",
    "writing.space": "Espacio de escritura",
    "writing.placeholder": "Empieza a escribir tu nota...",
    "writing.stopRecording": "Detener grabación",
    "writing.recordVoice": "Grabar voz",
    "assistant.title": "Conversación de la nota",
    "assistant.search": "Buscar en esta conversación",
    "assistant.askPlaceholder": "Pregunta a la IA sobre esta nota o sus archivos",
    "assistant.send": "Enviar",
    "assistant.sending": "Enviando...",
    "assistant.voice": "Voz",
    "auth.lightMode": "Modo claro",
    "auth.darkMode": "Modo oscuro",
    "auth.welcomeBack": "Bienvenido de nuevo",
    "auth.createAccount": "Crea tu cuenta",
    "auth.chooseNewPassword": "Elige una nueva contraseña",
    "auth.fullName": "Nombre completo",
    "auth.email": "Correo electrónico",
    "auth.password": "Contraseña",
    "auth.confirmPassword": "Confirmar contraseña",
    "auth.pleaseWait": "Espera un momento...",
    "auth.login": "Iniciar sesión",
    "auth.signup": "Registrarse",
    "auth.resetPassword": "Restablecer contraseña",
    "auth.forgotPassword": "¿Olvidaste tu contraseña?",
    "auth.noAccount": "¿No tienes una cuenta?",
    "auth.haveAccount": "¿Ya tienes una cuenta?",
    "auth.remembered": "¿La recordaste?",
    "auth.signupCta": "Registrarse",
    "auth.loginCta": "Iniciar sesión",
    "auth.or": "O",
    "auth.show": "Mostrar",
    "auth.hide": "Ocultar",
    "tab.uploads": "Archivos",
    "tab.viewer": "Visor de archivos",
    "tab.assistant": "Asistente IA",
    "uploads.count": "elementos adjuntos",
    "uploads.addLink": "Agregar enlace",
    "uploads.dropHint": "Arrastra y suelta archivos aquí, o haz clic para explorar.",
    "uploads.supported": "Soporta imágenes, PDF, documentos, video, audio y enlaces.",
    "uploads.added": "Añadido",
    "uploads.remove": "Eliminar",
    "uploads.empty": "Aún no hay archivos. Agrega un archivo o enlace para empezar.",
    "viewer.openSource": "Abrir fuente",
    "viewer.openLink": "Abrir enlace",
    "viewer.openDocument": "Abrir documento",
    "viewer.collapse": "Colapsar",
    "viewer.expand": "Expandir",
    "viewer.selectFile": "Selecciona un archivo de la pestaña Archivos para abrirlo en el visor.",
    "viewer.noLink": "No hay enlace disponible.",
    "viewer.extraction": "Extracción",
    "viewer.documentInlineUnsupported": "Los archivos Word, PowerPoint y hojas de cálculo no siempre pueden mostrarse dentro del navegador en localhost.",
    "viewer.previewLoadFailed": "No se pudo cargar la vista previa integrada. Usa Abrir fuente en su lugar.",
    "app.shareCopied": "Enlace de compartir copiado.",
    "app.addLinkPrompt": "Pega una URL para adjuntarla a esta nota:",
    "app.authChecking": "Comprobando sesión...",
    "app.sessionRestoring": "Restaurando tu sesión...",
    "app.sessionUserFallback": "Usuario AYMO",
    "app.noteUntitled": "Nota sin título",
    "app.noteUntagged": "sin etiqueta",
    "app.relativeJustNow": "Justo ahora",
    "app.firstNotePrompt": "Crea tu primera nota para empezar a escribir.",
    "app.newNoteError": "No se pudo crear una nueva nota en este momento.",
    "app.deleteNoteError": "No se pudo eliminar esta nota en este momento.",
    "app.uploadRemoveError": "No se pudo eliminar este archivo en este momento.",
    "record.ready": "La captura de voz está lista.",
    "record.finishing": "Finalizando transcripción...",
    "record.unavailable": "La transcripción de voz no está disponible.",
    "record.connectInternet": "Conéctate a internet para iniciar la grabación.",
    "record.micRequired": "Se requiere acceso al micrófono.",
    "record.recording": "Grabando...",
    "record.stopped": "Grabación detenida.",
    "record.stoppedAdded": "Grabación detenida. Transcripción agregada a tu nota.",
    "record.voiceStopped": "Transcripción de voz detenida.",
    "auth.passwordsMismatch": "Las contraseñas no coinciden.",
    "auth.resetLinkInvalid": "El enlace para restablecer contraseña falta o no es válido.",
    "auth.authFailed": "La autenticación falló.",
    "auth.googleLoading": "Cargando inicio de sesión con Google...",
    "auth.googleTokenMissing": "Google no devolvió un token de identidad válido.",
    "auth.googleFailed": "La autenticación con Google falló.",
    "auth.googleLoadFailed": "El inicio de sesión con Google no pudo cargarse en este navegador por ahora.",
    "auth.googleStillLoading": "El inicio de sesión con Google aún se está cargando.",
    "auth.appleNotReady": "El inicio de sesión con Apple no está listo en este entorno.",
    "auth.appleInitFailed": "No se pudo inicializar Apple en este navegador.",
    "auth.appleTokenMissing": "Apple no devolvió un token de identidad.",
    "auth.appleFailed": "La autenticación con Apple falló.",
    "auth.enterEmailFirst": "Primero ingresa tu correo para saber qué cuenta restablecer.",
    "auth.resetStartFailed": "No se pudo iniciar el restablecimiento de contraseña.",
    "assistant.filterAll": "Todo",
    "assistant.filterMine": "Mis mensajes",
    "assistant.filterReplies": "Respuestas IA",
  },
  de: {
    "settings.title": "Einstellungen",
    "settings.back": "Zurück",
    "settings.theme": "Design",
    "settings.language": "Sprache",
    "settings.languageLabel": "Bevorzugte Sprache",
    "settings.account": "Konto",
    "settings.name": "Name",
    "settings.email": "E-Mail",
    "settings.logout": "Abmelden",
    "settings.profileTitle": "Profil",
    "app.settings": "Einstellungen",
    "app.light": "Hell",
    "app.dark": "Dunkel",
    "language.en": "Englisch",
    "language.ar": "Arabisch",
    "language.fr": "Französisch",
    "language.es": "Spanisch",
    "language.de": "Deutsch",
    "home.title": "Meine Notizen",
    "home.createNote": "Notiz erstellen",
    "home.creating": "Wird erstellt...",
    "home.searchPlaceholder": "Notizen nach Titel oder Inhalt suchen",
    "app.back": "Zurück",
    "app.share": "Teilen",
    "app.save": "Speichern",
    "home.tags": "Tags",
    "home.startWriting": "Beginne mit dem Schreiben deiner Notiz...",
    "home.words": "Wörter",
    "home.pin": "Anheften",
    "home.unpin": "Lösen",
    "home.delete": "Löschen",
    "home.emptyNotes": "Keine Notizen gefunden.",
    "writing.title": "Titel",
    "writing.space": "Schreibbereich",
    "writing.placeholder": "Beginne mit dem Schreiben deiner Notiz...",
    "writing.stopRecording": "Aufnahme stoppen",
    "writing.recordVoice": "Sprache aufnehmen",
    "assistant.title": "Notiz-Konversation",
    "assistant.search": "Diese Unterhaltung durchsuchen",
    "assistant.askPlaceholder": "Frage die KI zu dieser Notiz oder ihren Uploads",
    "assistant.send": "Senden",
    "assistant.sending": "Wird gesendet...",
    "assistant.voice": "Sprache",
    "auth.lightMode": "Heller Modus",
    "auth.darkMode": "Dunkler Modus",
    "auth.welcomeBack": "Willkommen zurück",
    "auth.createAccount": "Erstelle dein Konto",
    "auth.chooseNewPassword": "Wähle ein neues Passwort",
    "auth.fullName": "Vollständiger Name",
    "auth.email": "E-Mail",
    "auth.password": "Passwort",
    "auth.confirmPassword": "Passwort bestätigen",
    "auth.pleaseWait": "Bitte warten...",
    "auth.login": "Anmelden",
    "auth.signup": "Registrieren",
    "auth.resetPassword": "Passwort zurücksetzen",
    "auth.forgotPassword": "Passwort vergessen?",
    "auth.noAccount": "Noch kein Konto?",
    "auth.haveAccount": "Hast du bereits ein Konto?",
    "auth.remembered": "Wieder eingefallen?",
    "auth.signupCta": "Registrieren",
    "auth.loginCta": "Anmelden",
    "auth.or": "ODER",
    "auth.show": "Anzeigen",
    "auth.hide": "Ausblenden",
    "tab.uploads": "Uploads",
    "tab.viewer": "Datei-Viewer",
    "tab.assistant": "KI-Assistent",
    "uploads.count": "Elemente angehängt",
    "uploads.addLink": "Link hinzufügen",
    "uploads.dropHint": "Dateien hier ablegen oder zum Durchsuchen klicken.",
    "uploads.supported": "Unterstützt Bilder, PDFs, Dokumente, Video, Audio und Links.",
    "uploads.added": "Hinzugefügt",
    "uploads.remove": "Entfernen",
    "uploads.empty": "Noch keine Uploads. Füge eine Datei oder einen Link hinzu, um zu starten.",
    "viewer.openSource": "Quelle öffnen",
    "viewer.openLink": "Link öffnen",
    "viewer.openDocument": "Dokument öffnen",
    "viewer.collapse": "Einklappen",
    "viewer.expand": "Ausklappen",
    "viewer.selectFile": "Wähle eine Datei im Uploads-Tab aus, um sie im Viewer zu öffnen.",
    "viewer.noLink": "Kein Link verfügbar.",
    "viewer.extraction": "Extraktion",
    "viewer.documentInlineUnsupported": "Word-, PowerPoint- und Tabellen-Dateien können im Browser auf localhost nicht immer inline dargestellt werden.",
    "viewer.previewLoadFailed": "Inline-Vorschau konnte nicht geladen werden. Verwende stattdessen Quelle öffnen.",
    "app.shareCopied": "Freigabelink kopiert.",
    "app.addLinkPrompt": "Füge eine URL ein, die an diese Notiz angehängt werden soll:",
    "app.authChecking": "Sitzung wird geprüft...",
    "app.sessionRestoring": "Sitzung wird wiederhergestellt...",
    "app.sessionUserFallback": "AYMO-Benutzer",
    "app.noteUntitled": "Unbenannte Notiz",
    "app.noteUntagged": "ohne Tag",
    "app.relativeJustNow": "Gerade eben",
    "app.firstNotePrompt": "Erstelle deine erste Notiz, um mit dem Schreiben zu beginnen.",
    "app.newNoteError": "Eine neue Notiz konnte gerade nicht erstellt werden.",
    "app.deleteNoteError": "Diese Notiz konnte gerade nicht gelöscht werden.",
    "app.uploadRemoveError": "Dieser Upload konnte gerade nicht entfernt werden.",
    "record.ready": "Sprachaufnahme ist bereit.",
    "record.finishing": "Transkription wird abgeschlossen...",
    "record.unavailable": "Sprachtranskription nicht verfügbar.",
    "record.connectInternet": "Verbinde dich mit dem Internet, um die Aufnahme zu starten.",
    "record.micRequired": "Mikrofonzugriff ist erforderlich.",
    "record.recording": "Aufnahme läuft...",
    "record.stopped": "Aufnahme gestoppt.",
    "record.stoppedAdded": "Aufnahme gestoppt. Transkript wurde zu deiner Notiz hinzugefügt.",
    "record.voiceStopped": "Sprachtranskription gestoppt.",
    "auth.passwordsMismatch": "Passwörter stimmen nicht überein.",
    "auth.resetLinkInvalid": "Link zum Zurücksetzen fehlt oder ist ungültig.",
    "auth.authFailed": "Authentifizierung fehlgeschlagen.",
    "auth.googleLoading": "Google-Anmeldung wird geladen...",
    "auth.googleTokenMissing": "Google hat kein nutzbares Identitätstoken zurückgegeben.",
    "auth.googleFailed": "Google-Authentifizierung fehlgeschlagen.",
    "auth.googleLoadFailed": "Google-Anmeldung konnte in diesem Browser derzeit nicht geladen werden.",
    "auth.googleStillLoading": "Google-Anmeldung wird noch geladen.",
    "auth.appleNotReady": "Apple-Anmeldung ist in dieser Umgebung nicht bereit.",
    "auth.appleInitFailed": "Apple-Anmeldung konnte in diesem Browser nicht initialisiert werden.",
    "auth.appleTokenMissing": "Apple hat kein Identitätstoken zurückgegeben.",
    "auth.appleFailed": "Apple-Authentifizierung fehlgeschlagen.",
    "auth.enterEmailFirst": "Gib zuerst deine E-Mail ein, damit wir wissen, welches Konto zurückgesetzt werden soll.",
    "auth.resetStartFailed": "Passwortzurücksetzung konnte nicht gestartet werden.",
    "assistant.filterAll": "Alle",
    "assistant.filterMine": "Meine Nachrichten",
    "assistant.filterReplies": "KI-Antworten",
  },
  ha: {
    "settings.theme": "Jigo",
    "settings.language": "Harshe",
    "settings.logout": "Fita",
    "language.en": "Turanci",
    "language.ar": "Larabci",
    "language.fr": "Faransanci",
    "language.es": "Sifaniyanci",
    "language.de": "Jamusanci",
    "language.ha": "Hausa",
    "home.title": "Bayanan kula na",
    "home.createNote": "Kirkiri Bayani",
    "home.creating": "Ana kirkira...",
    "home.tags": "Alamu",
    "home.words": "kalmomi",
    "home.emptyNotes": "Ba a sami bayanai ba.",
    "assistant.askPlaceholder": "Tambayi AYMO AI...",
  },
};

interface I18nContextValue {
  language: LanguageCode;
  setLanguage: (next: string) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function normalizeLanguageCode(value: string | null | undefined): LanguageCode {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized in TRANSLATIONS) {
    return normalized as LanguageCode;
  }
  return LANGUAGE_NAME_TO_CODE[normalized] ?? FALLBACK_LANGUAGE;
}

export function languageCodeToName(code: string): string {
  const normalized = normalizeLanguageCode(code);
  return CODE_TO_LANGUAGE_NAME[normalized];
}

export function languageCodeToSpeechLocale(code: string): string {
  switch (normalizeLanguageCode(code)) {
    case "ar":
      return "ar-SA";
    case "fr":
      return "fr-FR";
    case "es":
      return "es-ES";
    case "de":
      return "de-DE";
    case "ha":
      return "ha-NG";
    default:
      return "en-US";
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(FALLBACK_LANGUAGE);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage: (next) => {
        const normalized = normalizeLanguageCode(next);
        setLanguageState(normalized);
        document.documentElement.lang = normalized;
        document.documentElement.dir = normalized === "ar" ? "rtl" : "ltr";
      },
      t: (key) => TRANSLATIONS[language][key] ?? TRANSLATIONS.en[key] ?? key,
    }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider.");
  }
  return context;
}
