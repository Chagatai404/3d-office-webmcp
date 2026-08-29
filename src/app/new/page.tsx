import Link from "next/link";
import { CreateRoomForm } from "@/components/onboarding/create-room-form";
import styles from "@/components/onboarding/onboarding.module.css";

export default function NewRoomPage() {
  return (
    <main className={styles.onboardingShell}>
      <header className={styles.onboardingHeader}>
        <Link className={styles.backLink} href="/">
          <span aria-hidden="true">←</span> Decision Office
        </Link>
        <p className={styles.stepLabel}>New room · Step 1 of 2</p>
      </header>

      <div className={styles.onboardingLayout}>
        <section className={styles.onboardingIntro} aria-labelledby="new-room-title">
          <p className={styles.eyebrow}>Create a decision room</p>
          <h1 id="new-room-title" className={styles.onboardingTitle}>
            Start with the decision and the people it affects.
          </h1>
          <p className={styles.onboardingCopy}>
            You’ll take the first participant seat as organizer. Everyone else
            receives a private invitation to join their role.
          </p>
          <ol className={styles.processList}>
            <li>
              <span>1</span>
              Frame the decision
            </li>
            <li>
              <span>2</span>
              Invite perspectives
            </li>
            <li>
              <span>3</span>
              Decide with people in control
            </li>
          </ol>
        </section>

        <CreateRoomForm />
      </div>
    </main>
  );
}
