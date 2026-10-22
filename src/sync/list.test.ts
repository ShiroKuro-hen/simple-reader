import { describe, expect, it } from 'vitest';
import { parseList } from './r2';

// Response shape taken from the AWS S3 ListObjectsV2 API reference (namespace, <Prefix/>,
// ETag quoted, CommonPrefixes, ContinuationToken echo). Keys adapted to our layout.
const AWS_STYLE_PAGE_1 = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>simple-reader</Name>
  <Prefix/>
  <KeyCount>2</KeyCount>
  <MaxKeys>2</MaxKeys>
  <IsTruncated>true</IsTruncated>
  <ContinuationToken>1ueGcxLPRx1Tr/XYExHnhbYLgveDs2J/wm36Hy4vbOwM=</ContinuationToken>
  <NextContinuationToken>1a2b3c/+4d5e==</NextContinuationToken>
  <Contents>
    <Key>books/Tom &amp; Jerry (1).epub</Key>
    <LastModified>2009-10-12T17:50:30.000Z</LastModified>
    <ETag>"fba9dede5f27731c9771645a39863328"</ETag>
    <Size>434234</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>
  <Contents>
    <Key>books/吾輩は猫である.epub</Key>
    <LastModified>2009-10-12T17:50:31.000Z</LastModified>
    <ETag>"2f3c2f9f2b5e1c0e2b9d3f6a8c7d1e00"</ETag>
    <Size>1024</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>
  <CommonPrefixes><Prefix>books/sub/</Prefix></CommonPrefixes>
</ListBucketResult>`;

const AWS_STYLE_LAST_PAGE = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>simple-reader</Name><Prefix>meta/</Prefix><KeyCount>1</KeyCount><MaxKeys>1000</MaxKeys>
  <IsTruncated>false</IsTruncated>
  <Contents><Key>meta/abc.json</Key><Size>120</Size></Contents>
</ListBucketResult>`;

const EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>b</Name><Prefix>x/</Prefix><KeyCount>0</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated></ListBucketResult>`;

describe('parseList on ListObjectsV2 bodies', () => {
  it('truncated page: unescapes keys, keeps unicode, returns the NEXT token (not the echoed one)', () => {
    expect(parseList(AWS_STYLE_PAGE_1)).toEqual({
      keys: ['books/Tom & Jerry (1).epub', 'books/吾輩は猫である.epub'],
      next: '1a2b3c/+4d5e==',
    });
  });
  it('last page has no next token', () => {
    expect(parseList(AWS_STYLE_LAST_PAGE)).toEqual({ keys: ['meta/abc.json'], next: undefined });
  });
  it('empty listing', () => {
    expect(parseList(EMPTY)).toEqual({ keys: [], next: undefined });
  });
});
