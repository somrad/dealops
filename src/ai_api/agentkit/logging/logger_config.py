import logging
import sys
from pathlib import Path


class AgentLogger:
    """Standardized logging for all agents across all companies.

    Usage:
        from agentkit.logging import setup_logger

        logger = setup_logger("travel_agent")                                        # stdout only
        logger = setup_logger("travel_agent", log_dir="travel_agent/logs")           # stdout + file
        logger = setup_logger("travel_agent", log_dir="logs", console=False)         # file only
        logger = setup_logger("travel_agent", log_dir="logs", console=True, file=True)  # both
    """

    FORMAT = "%(asctime)s | %(name)-20s | %(levelname)-8s | %(message)s"
    DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

    @classmethod
    def setup(cls, name: str, level: int = logging.INFO,
            log_dir: str = None, console: bool = True, file: bool = True) -> logging.Logger:
        logger = logging.getLogger(name)

        if logger.handlers:
            return logger

        logger.setLevel(level)
        formatter = logging.Formatter(cls.FORMAT, datefmt=cls.DATE_FORMAT)

        if console:
            console_handler = logging.StreamHandler(sys.stdout)
            console_handler.setLevel(level)
            console_handler.setFormatter(formatter)
            logger.addHandler(console_handler)

        if file and log_dir:
            log_path = Path(log_dir)
            log_path.mkdir(parents=True, exist_ok=True)
            file_handler = logging.FileHandler(log_path / f"{name}.log")
            file_handler.setLevel(level)
            file_handler.setFormatter(formatter)
            logger.addHandler(file_handler)

        return logger


def setup_logger(name: str, level: int = logging.INFO,
                log_dir: str = None, console: bool = True, file: bool = True) -> logging.Logger:
    """Convenience function — the one everyone imports."""
    return AgentLogger.setup(name, level, log_dir=log_dir, console=console, file=file)