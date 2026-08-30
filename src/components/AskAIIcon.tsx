import React from "react";

interface AskAIIconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function AskAIIcon({
  size = 18,
  strokeWidth = 2,
  className = "",
}: AskAIIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M 9.5 16 C 9 17.5 7.5 19 6 19 C 4.5 19 4 17.5 5 15.5 C 6.5 13 10 7 12 5 C 14 7 17.5 13 19 15.5 C 20 17.5 19.5 19 18 19 C 16.5 19 15 17.5 14.5 16 C 14 14.5 14 11.5 12 11.5 C 10.5 11.5 9.5 12.5 9.5 13.5" />
    </svg>
  );
}
