import Link from "next/link";
import styles from "@/components/onboarding/onboarding.module.css";

export default function Home() {
  return (
    <main className={styles.homeShell}>
      <nav className={styles.homeNav} aria-label="Product navigation">
        <Link className={styles.brand} href="/">
          <span aria-hidden="true" className={styles.brandMark}>
            3D
          </span>
          Decision Office
        </Link>
        <Link className={styles.navLink} href="/room/demo">
          Open demo
        </Link>
      </nav>

      <section className={styles.hero} aria-labelledby="home-title">
        <p className={styles.eyebrow}>A shared workspace for consequential choices</p>
        <h1 id="home-title" className={styles.heroTitle}>
          Agents negotiate. <span>People decide.</span>
        </h1>
        <p className={styles.heroCopy}>
          Bring the right perspectives into one decision room, surface the
          tradeoffs, and keep final authority with people.
        </p>
        <div className={styles.heroActions}>
          <Link className={styles.primaryAction} href="/new">
            Create decision room
            <span aria-hidden="true">→</span>
          </Link>
          <Link className={styles.secondaryAction} href="/room/demo">
            Open demo
          </Link>
        </div>
        <p className={styles.demoNote}>
          Create a real room for your team, or explore a separate guided demo.
        </p>
      </section>

      <aside className={styles.homeSignal} aria-label="How a decision room works">
        <span>01 · Gather perspectives</span>
        <span>02 · Resolve tradeoffs</span>
        <span>03 · Approve together</span>
      </aside>
    </main>
  );
}
