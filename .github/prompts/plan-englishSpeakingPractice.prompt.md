# English Speaking Practice Website — Plan

## Project Goal
Build a web app that helps users improve English speaking ability through daily AI-coached conversations on structured topics.

## Core Requirements
- Daily practice sessions with an AI coach
- Each conversation is centered on a single topic (~5 minutes)
- Minimum daily goal: at least 3 topics per day, about 15 minutes
- Conversational, interactive interface (not just reading/writing)

## Open Questions (to be refined)
- **Tech stack**: What framework / backend? (e.g., Next.js + OpenAI, plain HTML + API) next.js + whatever AI models are best for chat + speech-to-text + TTS
- **Voice vs text**: Is this voice-based (speech-to-text / TTS) or text-chat only? voice-based with optional text display
- **Topic library**: Pre-defined topic list, AI-generated, or user-chosen? ai-generated with some pre-defined categories (e.g., daily life, work, news, entertainment)
- **Progress tracking**: Should the app track daily streaks, vocabulary, fluency scores? Yes, but keep it simple and focused on encouraging daily practice rather than detailed analytics
- **User accounts**: Login/auth required, or anonymous/local-storage sessions? anonymous for MVP, with optional account creation for progress tracking and cross-device sync
- **Feedback**: Does the AI give corrections, suggestions, or scores after each session? Yes, but keep it positive and encouraging rather than critical. Focus on a few key corrections (e.g., common grammar mistakes) and new vocabulary introduced during the conversation.
- **Deployment**: Self-hosted, Vercel, or other platform? Vercel for ease of deployment and scalability, especially if using Next.js

## Initial Feature Ideas

### Session Flow
1. User picks (or is assigned) a topic
2. 5-minute conversation with AI coach on that topic
3. End-of-session feedback (corrections, new vocabulary, encouragement)
4. Prompt to start next topic if daily goal not yet met

### Topic Examples
- Introduce yourself / your job
- Describe your weekend plans
- Talk about a recent news story
- Discuss a favorite movie or book
- Handle a job interview question

### Progress Dashboard
- Daily streak counter
- Minutes practiced today / this week
- Topics covered
- Common mistakes log

### AI Coach Behavior
- Keeps conversation natural and encouraging
- Corrects grammar/pronunciation gently
- Introduces new vocabulary in context
- Adapts difficulty to user level

## Proposed Tech Stack (draft)
- **Frontend**: Next.js (React) + Tailwind CSS
- **AI**: OpenAI GPT-4o (chat) + Whisper (speech-to-text) + TTS API
- **Auth**: NextAuth or Clerk (optional)
- **Storage**: Supabase or local storage for session history
- **Hosting**: Vercel

## Next Steps
- [ ] Confirm voice vs text interaction mode
- [ ] Confirm tech stack
- [ ] Confirm scope of progress tracking
- [ ] Design conversation flow and UI mockups
- [ ] Build MVP: single topic session with AI coach
