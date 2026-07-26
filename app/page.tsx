import { AppShell } from "@/components/app-shell";
import { Landing } from "@/components/landing";

export default function HomePage() {
  return (
    <AppShell bare landing>
      <Landing />
    </AppShell>
  );
}
