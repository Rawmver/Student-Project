import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background p-4">
      <div className="flex flex-col items-center text-center space-y-6 max-w-md">
        <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center">
          <AlertCircle className="h-10 w-10 text-destructive" />
        </div>
        
        <h1 className="text-4xl font-bold tracking-tight">Page Not Found</h1>
        <p className="text-muted-foreground text-lg">
          We couldn't find the page you were looking for. It might have been moved or doesn't exist.
        </p>
        
        <Link href="/">
          <Button size="lg" className="gap-2">
            Return Home
          </Button>
        </Link>
      </div>
    </div>
  );
}
