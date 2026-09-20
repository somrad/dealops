import Brand from "./Brand";
import ProfileMenu from "./ProfileMenu";

function Navbar({ user, onLogout }) {
  return (
    <header className="navbar">
      <Brand />
      <ProfileMenu user={user} onLogout={onLogout} />
    </header>
  );
}

export default Navbar;
