import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from pyobd.elm import ELM  # noqa: E402
from pyobd.obd import Obd, decode_dtcs  # noqa: E402
from pyobd.sim import SimLink  # noqa: E402
from pyobd.uds import UDS, UDSError, classify  # noqa: E402


def make(**kw):
    elm = ELM(SimLink(**kw))
    elm.init()
    return elm


class Core(unittest.TestCase):
    def test_init_and_pids(self):
        elm = make()
        self.assertIn('0C', elm.supported)
        self.assertTrue(elm.is_can)
        o = Obd(elm)
        v = o.read_many(o.supported_defs())
        self.assertIn('0C', v)

    def test_dtc_and_clear(self):
        o = Obd(make())
        self.assertEqual(o.read_dtcs('03'), ['P0171', 'P2187'])
        self.assertTrue(o.clear_dtcs()[0])
        self.assertEqual(o.read_dtcs('03'), [])

    def test_vin_info(self):
        o = Obd(make())
        self.assertEqual(o.read_vin(), 'WVWZZZ1KZ6W000001')
        self.assertEqual(o.read_info('04'), 'MAE06A906032CA')

    def test_decode_dtcs_k_line(self):
        self.assertEqual(decode_dtcs(['43 01 71 21 87'], False), ['P0171', 'P2187'])

    def test_readiness(self):
        o = Obd(make())
        s = Obd.decode_status(o.read_status())
        self.assertTrue(s['mil'])
        self.assertEqual(s['count'], 2)

    def test_mode06(self):
        rows = Obd(make()).read_mode06()
        self.assertEqual(len(rows), 2)

    def test_classify(self):
        self.assertTrue(classify(bytes.fromhex('2EF19901'))[2])
        self.assertFalse(classify(bytes.fromhex('22F190'))[2])


class Write(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_raw_read(self):
        u = UDS(make(), self.tmp)
        r = u.send('22F190', '7E0', '7E8')
        self.assertEqual(r.payload[3:], b'WVWZZZ1KZ6W000001')

    def test_negative(self):
        u = UDS(make(), self.tmp)
        self.assertTrue(u.send('22FFFF', '7E0').negative)

    def test_write_did_backup_verify(self):
        link = SimLink()
        u = UDS(ELM(link), self.tmp)
        u.elm.init()
        u.send('1003', '7E0')
        old, bk = u.write_did(0xF199, bytes([1, 2, 3, 4]), '7E0')
        self.assertEqual(old, bytes([0x20, 0x26, 0x01, 0x10]))
        self.assertEqual(link.dids[0xF199], bytes([1, 2, 3, 4]))
        self.assertTrue(os.path.exists(bk))
        self.assertTrue(os.path.exists(os.path.join(self.tmp, 'yazma_gunlugu.csv')))

    def test_write_refused_low_battery(self):
        u = UDS(make(battery=11.2), self.tmp)
        with self.assertRaises(UDSError):
            u.write_did(0xF199, b'\x00\x00\x00\x00', '7E0')

    def test_write_refused_unknown_did(self):
        u = UDS(make(), self.tmp)
        with self.assertRaises(UDSError):
            u.write_did(0x1234, b'\x01', '7E0')  # okunamayan DID: yedek alınamaz, yazılmaz


if __name__ == '__main__':
    unittest.main()
