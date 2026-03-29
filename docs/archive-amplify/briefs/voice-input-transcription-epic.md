# Product Epic: Voice Input & Transcription for Short Answer Challenges

## 1. Epic Title & Summary

**Title:** Voice Input & Transcription for Assessments

**Summary:** This epic introduces voice input and automated transcription for candidate responses in assessments, starting with Short Answer challenges and potentially expanding to other challenge types and candidate feedback. This allows candidates to respond verbally, providing richer, more nuanced answers, while also providing recruiters with a searchable text transcript for efficient review.

## 2. Business Value & Goals

*   **Improved Candidate Experience:** Offers candidates a more natural and efficient way to respond to questions, especially on mobile devices.
*   **Enhanced Data Capture:** Captures not only the content of the response but also the tone and delivery, providing richer insights into the candidate's communication skills.
*   **Increased Recruiter Efficiency:** Provides recruiters with text transcripts of audio responses, allowing for faster review and keyword searching.
*   **Accessibility:** Provides an alternative input method for candidates who may have difficulty typing.
*   **Competitive Advantage:** Differentiates our platform by offering a modern, user-friendly assessment experience.

**Goals:**

*   Increase candidate engagement with Short Answer challenges by 15%.
*   Reduce the time recruiters spend reviewing Short Answer responses by 20%.
*   Achieve a transcription accuracy rate of 90% or higher.

## 3. Scope: Audio Recording (UX/UI)

*   **Recording Shell:** Implement a reusable `RecordingShell` component that handles audio recording, playback, and upload.
*   **UI Integration:** Integrate the `RecordingShell` into the `QUIZ_SHORT_ANSWER` challenge type.
*   **Mobile Optimization:** Ensure the recording experience is optimized for mobile devices.
*   **Accessibility:** Adhere to accessibility guidelines to ensure the recording interface is usable by candidates with disabilities.
*   **Visual Feedback:** Provide clear visual feedback to the candidate during recording, playback, and upload.
*   **Error Handling:** Implement robust error handling to gracefully handle issues such as microphone access problems or network connectivity issues.

## 4. Scope: Storage (S3/Amplify Storage)

*   **Secure Storage:** Store audio recordings securely in S3 via Amplify Storage.
*   **Scalability:** Design the storage solution to handle a large volume of audio recordings.
*   **Cost Optimization:** Optimize storage costs by using appropriate storage classes and lifecycle policies.
*   **Metadata:** Store metadata associated with the audio recording, such as candidate ID, challenge ID, and timestamp.
*   **Data Retention:** Implement a data retention policy to automatically delete old recordings after a specified period.

## 5. Scope: Transcription Pipeline (AWS Transcribe or similar agent Lambda)

*   **Automated Transcription:** Automatically transcribe audio recordings using AWS Transcribe or another AI API (e.g., Whisper via Lambda).
*   **Transcription Accuracy:** Optimize transcription accuracy by experimenting with different transcription models and parameters.
*   **Error Handling:** Implement robust error handling to handle transcription failures.
*   **Asynchronous Processing:** Process transcriptions asynchronously using a Lambda function or similar mechanism.
*   **Cost Optimization:** Optimize transcription costs by using spot instances or other cost-saving techniques.
*   **Language Support:** Support multiple languages for transcription.
*   **Profanity Filtering:** Implement profanity filtering to remove offensive language from transcriptions.

## 6. Scope: Recruiter UX (Playback + reading transcription on CandidateProfilePage)

*   **Playback Integration:** Integrate an audio playback component into the CandidateProfilePage.
*   **Transcription Display:** Display the text transcription of the audio recording on the CandidateProfilePage.
*   **Search Functionality:** Allow recruiters to search the transcription text for keywords.
*   **Annotation:** Allow recruiters to add annotations to specific parts of the audio recording or transcription.
*   **Accessibility:** Ensure the playback and transcription display are accessible to recruiters with disabilities.
*   **Permissions:** Implement appropriate permissions to control which recruiters have access to audio recordings and transcriptions.

## 7. Phased Rollout Plan (Tasks/Milestones)

**Phase 1: Proof of Concept**

*   **Task 1:** Implement the `RecordingShell` component.
*   **Task 2:** Integrate the `RecordingShell` into the `QUIZ_SHORT_ANSWER` challenge type.
*   **Task 3:** Configure Amplify Storage to store audio recordings.
*   **Task 4:** Implement a Lambda function to transcribe audio recordings using AWS Transcribe.
*   **Task 5:** Display the audio recording and transcription on a dedicated test page.

**Phase 2: Internal Testing**

*   **Task 6:** Conduct internal testing to identify and fix bugs.
*   **Task 7:** Optimize transcription accuracy and cost.
*   **Task 8:** Implement error handling and logging.

**Phase 3: Beta Release**

*   **Task 9:** Release the feature to a small group of beta users.
*   **Task 10:** Gather feedback from beta users and make improvements.

**Phase 4: General Availability**

*   **Task 11:** Release the feature to all users.
*   **Task 12:** Monitor performance and make further optimizations.

## 8. Technical Unknowns & Architectural ADR requirements.

**Technical Unknowns:**

*   Optimal transcription model and parameters for achieving high accuracy at a reasonable cost.
*   Scalability and performance of the transcription pipeline under high load.
*   Impact of audio quality on transcription accuracy.
*   Cross-browser compatibility of the `RecordingShell` component.

**Architectural ADR Requirements:**

*   **ADR-008: Audio Recording Architecture:** Defines the architecture for audio recording, storage, and transcription.
*   **ADR-009: Transcription Service Selection:** Documents the decision-making process for selecting a transcription service (AWS Transcribe vs. alternative).
*   **ADR-010: Data Retention Policy:** Defines the data retention policy for audio recordings and transcriptions.
*   **ADR-011: Security Considerations for Audio Data:** Addresses security concerns related to storing and processing sensitive audio data.
