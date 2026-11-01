"""ELM327 ile haberleşme katmanları: seri port (USB / Bluetooth COM), Wi-Fi (TCP)."""
import socket
import time


class Link:
    def write(self, data: bytes) -> None: raise NotImplementedError
    def read(self, timeout: float = 0.05) -> bytes: raise NotImplementedError
    def close(self) -> None: pass

    def flush(self) -> None:
        """Bekleyen eski veriyi at."""
        while self.read(0):
            pass


class SerialLink(Link):
    def __init__(self, port: str, baud: int = 38400):
        import serial  # pyserial: pip install pyserial
        self.ser = serial.Serial(port, baud, timeout=0.05, write_timeout=3)

    def write(self, data):
        self.ser.write(data)
        self.ser.flush()

    def read(self, timeout=0.05):
        self.ser.timeout = timeout
        return self.ser.read(self.ser.in_waiting or 1)

    def close(self):
        try: self.ser.close()
        except Exception: pass


class TcpLink(Link):
    """Wi-Fi ELM327 (genelde 192.168.0.10:35000). Bilgisayar adaptörün Wi-Fi ağına bağlı olmalı."""

    def __init__(self, host: str = '192.168.0.10', port: int = 35000):
        self.sock = socket.create_connection((host, port), timeout=6)

    def write(self, data):
        self.sock.sendall(data)

    def read(self, timeout=0.05):
        self.sock.settimeout(max(timeout, 0.001))
        try:
            return self.sock.recv(4096)
        except (socket.timeout, BlockingIOError):
            return b''

    def close(self):
        try: self.sock.close()
        except Exception: pass


def list_ports():
    try:
        from serial.tools import list_ports as lp
        return [(p.device, p.description) for p in lp.comports()]
    except Exception:
        return []
