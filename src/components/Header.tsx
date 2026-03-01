import Logo from "./ui/Logo";

interface ProfileHeaderProps {
  title?: string;
}

export function ProfileHeader({
  title = "PIPE",
}: ProfileHeaderProps) {
  return (
    <header
      style={{
        padding: "20px",
        display: "flex",
        alignItems: "center",
        gap: "16px"
      }}
    >
      <div style={{ width: 40, height: 40 }}>
        <Logo />
      </div>
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
    </header>
  );
}
