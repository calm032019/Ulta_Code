import { SparkleIcon } from "lucide-react";
import { useState } from "react";

function greetingForHour(hour: number): string {
  if (hour < 5) return "Burning the midnight oil";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The conversational greeting shown on an empty chat: a warm, serif headline
 * instead of a prompt-like question, so a new thread opens like a conversation.
 */
export function DraftHeroGreeting() {
  // Chosen once per mount so the headline does not flip while the user is typing.
  const [greeting] = useState(() => greetingForHour(new Date().getHours()));
  return (
    <h1 className="flex w-full items-center justify-center gap-3 text-center font-light text-3xl text-foreground tracking-tight sm:text-4xl">
      <SparkleIcon
        aria-hidden="true"
        className="size-7 shrink-0 fill-primary text-primary sm:size-8"
      />
      <span>{greeting}</span>
    </h1>
  );
}
