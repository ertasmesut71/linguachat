import { getAvatarGradient, getInitials, USER_STATUSES } from "../../lib/constants";
import { mediaUrl } from "../../api/client";

/**
 * Renders a circular avatar with gradient background and user initials.
 * Optionally shows an online status dot.
 *
 * @param {object} props
 * @param {object} props.user - User object with { id, displayName, avatarUrl, status }
 * @param {number} [props.size=42] - Pixel size
 * @param {boolean} [props.showStatus=false] - Show online status indicator
 */
export default function Avatar({ user, size = 42, showStatus = false }) {
  if (!user) return null;

  const gradientClass = getAvatarGradient(user.id);
  const initials = getInitials(user.displayName);
  const fontSize = Math.max(size * 0.36, 11);
  const statusConfig = USER_STATUSES[user.status] || USER_STATUSES.offline;
  const dotSize = Math.max(size * 0.26, 8);

  return (
    <div
      className={gradientClass}
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: size > 50 ? 18 : 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize,
        fontWeight: 600,
        color: "white",
        position: "relative",
        overflow: "visible",
      }}
    >
      {user.avatarUrl ? (
        <img
          src={mediaUrl(user.avatarUrl)}
          alt={user.displayName}
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "inherit",
            objectFit: "cover",
          }}
        />
      ) : (
        initials
      )}

      {showStatus && (
        <div
          style={{
            position: "absolute",
            bottom: -1,
            right: -1,
            width: dotSize,
            height: dotSize,
            borderRadius: "50%",
            background: statusConfig.color,
            border: "2px solid var(--bg-secondary)",
          }}
        />
      )}
    </div>
  );
}
