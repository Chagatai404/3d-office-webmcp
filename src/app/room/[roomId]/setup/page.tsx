import Link from "next/link";
import styles from "@/components/onboarding/onboarding.module.css";

export default async function RoomSetupPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;

  return (
    <main className={styles.setupShell}>
      <section className={styles.setupCard}>
        <p className={styles.eyebrow}>Room created</p>
        <h1>Organizer setup is next.</h1>
        <p>
          Your room is ready. Open the decision workspace now, or return here
          when you’re ready to prepare secure invitations for the other seats.
        </p>
        <div className={styles.heroActions}>
          <Link className={styles.primaryAction} href={`/room/${roomId}`}>
            Open room <span aria-hidden="true">→</span>
          </Link>
          <Link className={styles.secondaryAction} href="/">
            Back home
          </Link>
        </div>
      </section>
    </main>
  );
}
