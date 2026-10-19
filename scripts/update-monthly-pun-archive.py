#!/usr/bin/env python3
"""Append only monthly PUN Index GME F0, cross-checking two independently published tables.
This script does not call or alter existing ARERA/Mac importers.
"""
import argparse
import datetime as dt
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
SOURCES={
 'a2a':'https://www.a2a.it/assistenza/tutela-cliente/indici/indice-pun',
 'gassales':'https://www.gassalesenergia.it/info-utili/indice-dei-mercati-a-consuntivo/',
}
MONTHS={'gennaio':1,'febbraio':2,'marzo':3,'aprile':4,'maggio':5,'giugno':6,'luglio':7,'agosto':8,'settembre':9,'ottobre':10,'novembre':11,'dicembre':12}

class TableReader(HTMLParser):
 def __init__(self):
  super().__init__();self.tables=[];self.table=None;self.row=None;self.cell=None;self.cell_depth=0
 def handle_starttag(self,tag,attrs):
  if tag=='table' and self.table is None:self.table=[]
  elif self.table is not None and tag=='tr':self.row=[]
  elif self.row is not None and tag in ('td','th') and self.cell is None:self.cell=[];self.cell_depth=1
  elif self.cell is not None:self.cell_depth+=1
 def handle_data(self,data):
  if self.cell is not None:self.cell.append(data)
 def handle_endtag(self,tag):
  if self.cell is not None and tag not in ('td','th','tr','table'):
   self.cell_depth=max(1,self.cell_depth-1)
  elif tag in ('td','th') and self.cell is not None:
   self.row.append(' '.join(''.join(self.cell).split()));self.cell=None;self.cell_depth=0
  elif tag=='tr' and self.row is not None:
   if self.row:self.table.append(self.row)
   self.row=None
  elif tag=='table' and self.table is not None:
   self.tables.append(self.table);self.table=None

def number(raw):
 text=str(raw).strip().replace(' ', '').replace('\xa0','')
 if not re.fullmatch(r'\d+(?:[.,]\d+)?',text):return None
 try:return Decimal(text.replace(',','.'))
 except InvalidOperation:return None

def parse_a2a(text):
 parser=TableReader();parser.feed(text);values={}
 for table in parser.tables:
  for row in table:
   if len(row)<2:continue
   m=re.fullmatch(r'('+'|'.join(MONTHS)+r')\s+(20\d\d)',row[0].lower())
   if not m:continue
   val=number(row[1]);month=f'{m.group(2)}-{MONTHS[m.group(1)]:02d}'
   if val is None or not Decimal('0.001')<val<Decimal('5'):continue
   if month in values and values[month]!=val:raise ValueError('A2A value conflict: '+month)
   values[month]=val
 if not values:raise ValueError('A2A PUN monthly table missing or changed')
 return values

def parse_gassales(text):
 parser=TableReader();parser.feed(text);values={}
 for table in parser.tables:
  for row in table:
   if len(row)<7 or not re.fullmatch(r'20\d\d',row[0]):continue
   month=MONTHS.get(row[1].lower().strip())
   if not month:continue
   val=number(row[6]);key=f'{row[0]}-{month:02d}'
   if val is None or not Decimal('1')<val<Decimal('1000'):continue
   val=val/1000
   if key in values and values[key]!=val:raise ValueError('Gas Sales PUN value conflict: '+key)
   values[key]=val
 if not values:raise ValueError('Gas Sales PUN monthly table missing or changed')
 return values

def fetch(url):
 req=urllib.request.Request(url,headers={'User-Agent':'OffertaLogicaMonthlyIndices/1.0'})
 with urllib.request.urlopen(req,timeout=25) as response:
  if response.status!=200:raise ValueError('HTTP error '+str(response.status))
  return response.read(2_000_000).decode('utf-8','replace')

def merge(data,primary,check,today):
 series=data.setdefault('serie',{}).setdefault('pun_index_gme_f0_confermato',{
  'unita':'eur_kwh',
  'definizione':'PUN Index GME monorario F0, al netto delle perdite; due pubblicazioni secondarie concordanti. Non e una verifica diretta GME.',
  'mesi':{}})
 saved=series.setdefault('mesi',{})
 added=[];conflicts=[]
 for month,value in sorted(primary.items()):
  if month not in check or month>=today.strftime('%Y-%m') or month<'2026-07':continue
  # A2A displays six decimals, Gas Sales two decimals in EUR/MWh: precision 0.00001 EUR/kWh.
  if abs(value-check[month])>Decimal('0.000005'):
   conflicts.append(month);continue
  rounded=value.quantize(Decimal('0.000001'))
  if month in saved:
   if abs(Decimal(str(saved[month]['valore']))-rounded)>Decimal('0.0000005'):conflicts.append(month)
   continue
  saved[month]={'valore':float(rounded),'unita':'eur_kwh','periodo':month,
   'fonte':'A2A Energia e Gas Sales Energia (confronto mensile)',
   'urlFonte':SOURCES['a2a'],'urlControllo':SOURCES['gassales'],
   'acquisitoIl':today.isoformat(),'stato':'confermato_fonti_secondarie',
   'note':'Confronto alla precisione pubblicata: non equivale a verifica diretta GME; al netto delle perdite.'}
  added.append(month)
 if conflicts:raise ValueError('PUN mismatch; no output written: '+', '.join(conflicts))
 return added

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument('--a2a-html',type=Path);ap.add_argument('--gassales-html',type=Path)
 ap.add_argument('--date',help='YYYY-MM-DD; test reproducibility');ap.add_argument('--dry-run',action='store_true')
 args=ap.parse_args()
 today=dt.date.fromisoformat(args.date) if args.date else dt.date.today()
 a=parse_a2a(args.a2a_html.read_text() if args.a2a_html else fetch(SOURCES['a2a']))
 b=parse_gassales(args.gassales_html.read_text() if args.gassales_html else fetch(SOURCES['gassales']))
 src=ROOT/'data/archivio-indici-storici.json';dst=ROOT/'public/data/archivio-indici-storici.json'
 if src.read_bytes()!=dst.read_bytes():raise ValueError('Archive copies differ; aborting')
 data=json.loads(src.read_text());added=merge(data,a,b,today)
 print(json.dumps({'checked':len(set(a)&set(b)),'added':added},ensure_ascii=False))
 if added and not args.dry_run:
  payload=json.dumps(data,ensure_ascii=False,indent=2)+'\n'
  src.write_text(payload);dst.write_text(payload)
if __name__=='__main__':main()
