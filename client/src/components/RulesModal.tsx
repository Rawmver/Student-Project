import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";

type RulesModalProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function RulesModal({ open: controlledOpen, onOpenChange }: RulesModalProps) {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState("");
  const [requiredMembers, setRequiredMembers] = useState(6);
  const [requireLeader, setRequireLeader] = useState(true);

  useEffect(() => {
    const hasSeenRules = sessionStorage.getItem("hasSeenRules");
    if (!hasSeenRules && controlledOpen === undefined) {
      const timer = setTimeout(() => setOpen(true), 500);
      return () => clearTimeout(timer);
    }
  }, [controlledOpen]);

  useEffect(() => {
    fetch("/api/settings/rules").then(r => r.json()).then(d => { if (d.value) setRules(d.value); });
    fetch("/api/settings/required_members").then(r => r.json()).then(d => { if (d.value) setRequiredMembers(parseInt(d.value)); });
    fetch("/api/settings/group_require_leader").then(r => r.json()).then(d => setRequireLeader(d.value !== "false"));
  }, []);

  const handleClose = () => {
    setOpen(false);
    sessionStorage.setItem("hasSeenRules", "true");
    onOpenChange?.(false);
  };

  const teamStructureText = requireLeader
    ? `This project requires exactly 1 leader and ${requiredMembers} members per group.`
    : `This project requires exactly ${requiredMembers} members per group.`;

  return (
    <Dialog open={controlledOpen ?? open} onOpenChange={(next) => {
      if (controlledOpen === undefined) setOpen(next);
      onOpenChange?.(next);
      if (!next) sessionStorage.setItem("hasSeenRules", "true");
    }}>
      <DialogContent className="sm:max-w-lg rounded-2xl border-border bg-background p-0 shadow-xl">
        <div className="border-b border-border px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
            <Info className="h-5 w-5 text-primary" />
            Submission Rules
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            Please review these rules before submitting your group.
          </DialogDescription>
        </div>
        <div className="space-y-4 px-6 py-5 text-sm">
          <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
            <li>{teamStructureText}</li>
            <li>Use official names as per student ID.</li>
            <li>Enter correct student IDs.</li>
            <li>Only one submission per group is allowed.</li>
            <li>Double-check all details before submitting.</li>
            <li>No changes are allowed after submission.</li>
          </ul>
          {rules && <div className="rounded-lg border border-border bg-muted/40 p-4 text-muted-foreground whitespace-pre-wrap">{rules}</div>}
          <Button onClick={handleClose} className="w-full" data-testid="button-rules-understand">
            I Understand
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
