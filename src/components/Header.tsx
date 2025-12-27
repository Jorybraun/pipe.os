import React from "react";

interface SubTitleProps {
  children: React.ReactNode;
}

export function SubTitle({ children }: SubTitleProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 8,
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          background: "#fff",
          boxShadow: "0 0 10px #fff",
        }}
      />
      <span style={{ fontSize: 12, letterSpacing: "0.2em", opacity: 0.7 }}>
        {children}
      </span>
    </div>
  );
}

interface ProfileHeaderProps {
  title?: string;
  subtitle?: string;
}

export function ProfileHeader({
  title = "CANDIDATE_PROFILE",
  subtitle = "PIPE_OS // V.2.0.4",
}: ProfileHeaderProps) {
  return (
    <header
      style={{
        padding: "20px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 24,
      }}
    >
      <div>
        <SubTitle>{subtitle}</SubTitle>
        <h1
          style={{
            fontSize: 48,
            fontFamily: '"Monument Extended", sans-serif',
            fontWeight: 800,
            letterSpacing: "-0.02em",
            margin: 0,
            background:
              "linear-gradient(180deg, #fff 0%, rgba(255,255,255,0.5) 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {title}
        </h1>
      </div>
    </header>
  );
}
