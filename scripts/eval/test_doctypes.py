import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'embed'))
import doctypes


class LabReportClassificationTests(unittest.TestCase):
    def classify(self, text):
        return doctypes.classify(text, text, 2)[0]

    def test_recovered_report_heading_and_fields(self):
        text = ('AIRBORNE ASBESTOS ANALYSIS BY IRANSMISSION ELECTRON MICROSCOPY\n'
                'CLIENT: Warren & Panzer Engineers, P.C.\nLABORATORY ID #: T02-09-021\n'
                'ANALYT. METHODOLOGY: AHERA\nDATE OF ANALYSES: 09/08/02\n'
                'EFFECTIVE FILTER AREA (um\'): 385\nLABORATORY RESULTS\n0.0049')
        self.assertEqual(self.classify(text), 'lab_report')
        self.assertEqual(len(doctypes.lab_report_structure(text)), 4)

    def test_results_heading_and_alternative_field_spellings(self):
        text = 'Laboratory results:\nLab. No.: 123\nDate of analysis: 09/08/02'
        self.assertEqual(self.classify(text), 'lab_report')

    def test_heading_or_single_field_is_insufficient(self):
        for text in ['LABORATORY RESULTS', 'LABORATORY RESULTS\nLABORATORY ID #: 12']:
            self.assertEqual(self.classify(text), 'other')

    def test_narrative_mentions_are_not_report_structure(self):
        text = ('Dear Henry,\nPlease review the laboratory results and airborne asbestos analysis.\n'
                'The laboratory ID #: 123 and date of analyses: 09/08/02 are in the attachment.')
        self.assertEqual(self.classify(text), 'memo_letter')

    def test_distant_fields_do_not_support_heading(self):
        text = 'LABORATORY RESULTS\n' + 'unrelated text\n' * 200 + 'LABORATORY ID #: 123\nDATE OF ANALYSES: 09/08/02'
        self.assertEqual(self.classify(text), 'other')

    def test_higher_priority_document_types_preserved(self):
        text = 'INVOICE NUMBER: 123\nLABORATORY RESULTS\nLABORATORY ID #: 123\nDATE OF ANALYSES: 09/08/02'
        self.assertEqual(self.classify(text), 'invoice')


if __name__ == '__main__':
    unittest.main()
