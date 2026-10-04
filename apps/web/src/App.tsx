import { useEffect } from 'react';
import { useScience } from './state/science';
import { Stage } from './three/Stage';
import { CapabilityDock } from './ui/CapabilityDock';
import { CivHud } from './ui/CivHud';
import { ClockBar, useCivCapabilitySync, usePresenceReporter } from './ui/ClockBar';
import { CommandDeck } from './ui/CommandDeck';
import { Loader } from './ui/Loader';
import { MissionConsole } from './ui/MissionConsole';
import { ConceptCard, HelpOverlay, StopTitle, Toasts, TransitionOverlay, useJourneyKeys } from './ui/Overlays';
import { ScaleRail } from './ui/ScaleRail';
import { SelectionCard } from './ui/SelectionCard';
import { NamePrompt, PeopleBar } from './ui/PeopleBar';
import { TopBar } from './ui/TopBar';

export default function App() {
  const phase = useScience((s) => s.phase);
  const boot = useScience((s) => s.boot);
  useEffect(() => {
    void boot();
  }, [boot]);
  useJourneyKeys();
  usePresenceReporter();
  useCivCapabilitySync();
  const ready = phase === 'ready';
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      {ready ? <Stage /> : null}
      {ready ? (
        <>
          <TopBar />
          <ScaleRail />
          <StopTitle />
          <ClockBar />
          <CivHud />
          <MissionConsole />
          <CapabilityDock />
          <CommandDeck />
          <PeopleBar />
          <SelectionCard />
          <NamePrompt />
          <ConceptCard />
          <TransitionOverlay />
          <Toasts />
          <HelpOverlay />
        </>
      ) : null}
      <Loader />
    </div>
  );
}
