"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { createPlayerCharacterAction } from "../actions/create-player-character";

interface CreateCharacterFormProps {
  universeSlug: string;
}

export function CreateCharacterForm({ universeSlug }: CreateCharacterFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsPending(true);
    try {
      const result = await createPlayerCharacterAction({ universeSlug, name, pronouns });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.push(`/romance/${universeSlug}`);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card className="mx-auto max-w-md border-white/10 bg-[#1c1024]/80 text-[#f1e9f4]">
      <CardHeader>
        <CardTitle className="font-serif text-2xl">Create your character</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="character-name" className="text-[#e4d9ea]">
              Name
            </Label>
            <Input
              id="character-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Elowen"
              required
              maxLength={60}
              className="border-white/20 bg-[#120a18] text-[#f1e9f4]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="character-pronouns" className="text-[#e4d9ea]">
              Pronouns
            </Label>
            <Input
              id="character-pronouns"
              value={pronouns}
              onChange={(event) => setPronouns(event.target.value)}
              placeholder="she/her"
              required
              maxLength={30}
              className="border-white/20 bg-[#120a18] text-[#f1e9f4]"
            />
          </div>

          <Button
            type="submit"
            disabled={isPending || !name.trim() || !pronouns.trim()}
            className="w-full bg-[#5c3a73] text-white hover:bg-[#6d4788]"
          >
            {isPending && <Loader2 className="animate-spin" />}
            Begin the story
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
