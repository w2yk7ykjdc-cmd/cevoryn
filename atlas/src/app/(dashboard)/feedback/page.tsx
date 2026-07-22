import { Bug, Lightbulb, Mail, MessageSquare } from "lucide-react";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Feedback — Atlas" };

const FEEDBACK_EMAIL = "kemalkiyak06@gmail.com";

const feedbackOptions = [
  {
    title: "Report a problem",
    description: "Tell us what happened, what you expected, and which page you were using.",
    subject: "Atlas beta — problem report",
    icon: Bug,
  },
  {
    title: "Suggest an improvement",
    description: "Share a workflow, feature, or change that would make Atlas more useful.",
    subject: "Atlas beta — improvement suggestion",
    icon: Lightbulb,
  },
  {
    title: "Share general feedback",
    description: "Tell us what feels valuable, confusing, slow, or unnecessary.",
    subject: "Atlas beta — general feedback",
    icon: MessageSquare,
  },
] as const;

export default function FeedbackPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      <div>
        <p className="text-sm text-muted-foreground">Private beta</p>
        <h1 className="text-2xl font-bold tracking-tight">Help improve Atlas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Feedback is reviewed directly and used to prioritize the next product changes.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {feedbackOptions.map((option) => {
          const Icon = option.icon;
          const href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(option.subject)}&body=${encodeURIComponent("Page or workflow:\n\nWhat happened or what should change:\n\nWhy this matters:\n")}`;

          return (
            <Card key={option.title}>
              <CardHeader className="space-y-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">{option.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-relaxed text-muted-foreground">{option.description}</p>
                <Button asChild className="w-full">
                  <a href={href}>
                    <Mail className="h-4 w-4" />
                    Send feedback
                  </a>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="py-5 text-sm text-muted-foreground">
          Do not include passwords, API keys, private customer data, or other sensitive information in feedback messages.
        </CardContent>
      </Card>
    </div>
  );
}
