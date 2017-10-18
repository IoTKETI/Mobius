-- MySQL dump 10.13  Distrib 5.7.17, for Win64 (x86_64)
--
-- Host: localhost    Database: mobiusdb
-- ------------------------------------------------------
-- Server version	5.7.19-log

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `acp`
--

DROP TABLE IF EXISTS `acp`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `acp` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `pv` longtext,
  `pvs` longtext,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `acp_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ae`
--

DROP TABLE IF EXISTS `ae`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ae` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `apn` varchar(45) DEFAULT NULL,
  `api` varchar(45) DEFAULT NULL,
  `aei` varchar(200) DEFAULT NULL,
  `poa` varchar(200) DEFAULT NULL,
  `or` varchar(45) DEFAULT NULL,
  `rr` varchar(45) DEFAULT NULL,
  `nl` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `path_UNIQUE` (`ri`),
  UNIQUE KEY `aei_UNIQUE` (`aei`),
  CONSTRAINT `ae_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cb`
--

DROP TABLE IF EXISTS `cb`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `cb` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cst` varchar(45) DEFAULT NULL,
  `csi` varchar(45) DEFAULT NULL,
  `srt` varchar(100) DEFAULT NULL,
  `poa` varchar(200) DEFAULT NULL,
  `nl` varchar(45) DEFAULT NULL,
  `ncp` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `path_UNIQUE` (`ri`),
  CONSTRAINT `cb_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cin`
--

DROP TABLE IF EXISTS `cin`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `cin` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cr` varchar(45) DEFAULT NULL,
  `cnf` varchar(45) DEFAULT NULL,
  `cs` varchar(45) DEFAULT NULL,
  `or` varchar(45) DEFAULT NULL,
  `con` longtext,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  KEY `cin_ri_idx` (`ri`),
  CONSTRAINT `cin_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cnt`
--

DROP TABLE IF EXISTS `cnt`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `cnt` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cr` varchar(45) DEFAULT NULL,
  `mni` varchar(45) DEFAULT NULL,
  `mbs` varchar(45) DEFAULT NULL,
  `mia` varchar(45) DEFAULT NULL,
  `cni` varchar(45) DEFAULT NULL,
  `cbs` varchar(45) DEFAULT NULL,
  `li` varchar(45) DEFAULT NULL,
  `or` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `resourceid_UNIQUE` (`ri`),
  CONSTRAINT `cnt_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `csr`
--

DROP TABLE IF EXISTS `csr`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `csr` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cst` varchar(45) DEFAULT NULL,
  `poa` varchar(200) DEFAULT NULL,
  `cb` varchar(200) DEFAULT NULL,
  `csi` varchar(200) DEFAULT NULL,
  `mei` varchar(45) DEFAULT NULL,
  `tri` varchar(45) DEFAULT NULL,
  `rr` varchar(45) DEFAULT NULL,
  `nl` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  KEY `csr_ri_idx` (`ri`),
  CONSTRAINT `csr_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `grp`
--

DROP TABLE IF EXISTS `grp`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `grp` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cr` varchar(45) DEFAULT NULL,
  `mt` varchar(45) NOT NULL,
  `cnm` varchar(45) NOT NULL,
  `mnm` varchar(45) NOT NULL,
  `mid` mediumtext,
  `macp` mediumtext,
  `mtv` varchar(45) DEFAULT NULL,
  `csy` varchar(45) DEFAULT NULL,
  `gn` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `grp_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lcp`
--

DROP TABLE IF EXISTS `lcp`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `lcp` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `los` varchar(45) DEFAULT NULL,
  `lou` varchar(45) DEFAULT NULL,
  `lot` varchar(45) DEFAULT NULL,
  `lor` varchar(45) DEFAULT NULL,
  `loi` varchar(45) DEFAULT NULL,
  `lon` varchar(45) DEFAULT NULL,
  `lost` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `lcp_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lookup`
--

DROP TABLE IF EXISTS `lookup`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `lookup` (
  `pi` varchar(200) NOT NULL,
  `ty` varchar(8) NOT NULL,
  `ct` varchar(15) NOT NULL,
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `rn` varchar(45) NOT NULL,
  `lt` varchar(45) NOT NULL,
  `et` varchar(45) DEFAULT NULL,
  `acpi` varchar(200) DEFAULT NULL,
  `lbl` varchar(200) DEFAULT NULL,
  `at` varchar(45) DEFAULT NULL,
  `aa` varchar(45) DEFAULT NULL,
  `st` varchar(45) DEFAULT NULL,
  `mni` varchar(45) DEFAULT NULL,
  `cs` varchar(45) DEFAULT NULL,
  `sri` varchar(45) DEFAULT NULL,
  `spi` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`pi`,`ty`,`ct`,`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  KEY `idx_lookup_resourcetype` (`ty`),
  KEY `idx_lookup_parentid` (`pi`),
  KEY `idx_lookup_cs` (`cs`),
  KEY `idx_lookup_ct` (`ct`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mgo`
--

DROP TABLE IF EXISTS `mgo`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `mgo` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `mgd` varchar(45) DEFAULT NULL,
  `objs` varchar(45) DEFAULT NULL,
  `obps` varchar(45) DEFAULT NULL,
  `dc` varchar(45) DEFAULT NULL,
  `vr` varchar(45) DEFAULT NULL,
  `fwnnam` varchar(45) DEFAULT NULL,
  `url` varchar(45) DEFAULT NULL,
  `ud` varchar(45) DEFAULT NULL,
  `uds` varchar(45) DEFAULT NULL,
  `btl` varchar(45) DEFAULT NULL,
  `bts` varchar(45) DEFAULT NULL,
  `dbl` varchar(45) DEFAULT NULL,
  `man` varchar(45) DEFAULT NULL,
  `mod` varchar(45) DEFAULT NULL,
  `dty` varchar(45) DEFAULT NULL,
  `fwv` varchar(45) DEFAULT NULL,
  `swv` varchar(45) DEFAULT NULL,
  `hwv` varchar(45) DEFAULT NULL,
  `can` varchar(45) DEFAULT NULL,
  `att` varchar(45) DEFAULT NULL,
  `cas` varchar(45) DEFAULT NULL,
  `cus` varchar(45) DEFAULT NULL,
  `ena` varchar(45) DEFAULT NULL,
  `dis` varchar(45) DEFAULT NULL,
  `rbo` varchar(45) DEFAULT NULL,
  `far` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `mgo_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mms`
--

DROP TABLE IF EXISTS `mms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `mms` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `sid` varchar(45) DEFAULT NULL,
  `soid` varchar(45) DEFAULT NULL,
  `stid` varchar(45) DEFAULT NULL,
  `asd` varchar(45) DEFAULT NULL,
  `osd` varchar(45) DEFAULT NULL,
  `sst` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `mms_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `nod`
--

DROP TABLE IF EXISTS `nod`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `nod` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `ni` varchar(45) NOT NULL,
  `hcl` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `nod_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `req`
--

DROP TABLE IF EXISTS `req`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `req` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `op` varchar(45) NOT NULL,
  `tg` varchar(45) NOT NULL,
  `org` varchar(45) NOT NULL,
  `rid` varchar(45) NOT NULL,
  `mi` varchar(45) DEFAULT NULL,
  `pc` longtext,
  `rs` varchar(45) DEFAULT NULL,
  `ors` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `req_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `smd`
--

DROP TABLE IF EXISTS `smd`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `smd` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cr` varchar(45) DEFAULT NULL,
  `dcrp` longtext,
  `or` mediumtext,
  `dsp` longtext,
  `soe` varchar(200) DEFAULT NULL,
  `rels` varchar(400) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `sd_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sri`
--

DROP TABLE IF EXISTS `sri`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sri` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `sri` varchar(45) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `sri_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sub`
--

DROP TABLE IF EXISTS `sub`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sub` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `pi` varchar(400) DEFAULT NULL,
  `enc` varchar(45) DEFAULT NULL,
  `exc` varchar(45) DEFAULT NULL,
  `nu` varchar(200) DEFAULT NULL,
  `gpi` varchar(45) DEFAULT NULL,
  `nfu` varchar(45) DEFAULT NULL,
  `bn` varchar(45) DEFAULT NULL,
  `rl` varchar(45) DEFAULT NULL,
  `psn` varchar(45) DEFAULT NULL,
  `pn` varchar(45) DEFAULT NULL,
  `nsp` varchar(45) DEFAULT NULL,
  `ln` varchar(45) DEFAULT NULL,
  `nct` varchar(45) DEFAULT NULL,
  `nec` varchar(45) DEFAULT NULL,
  `cr` varchar(45) DEFAULT NULL,
  `su` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `resourceid_UNIQUE` (`ri`),
  CONSTRAINT `sub_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ts`
--

DROP TABLE IF EXISTS `ts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ts` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cr` varchar(45) DEFAULT NULL,
  `mni` varchar(45) DEFAULT NULL,
  `mbs` varchar(45) DEFAULT NULL,
  `mia` varchar(45) DEFAULT NULL,
  `cni` varchar(45) DEFAULT NULL,
  `cbs` varchar(45) DEFAULT NULL,
  `or` varchar(45) DEFAULT NULL,
  `pei` varchar(45) DEFAULT NULL,
  `mdd` varchar(45) DEFAULT NULL,
  `mdn` varchar(45) DEFAULT NULL,
  `mdl` longtext,
  `mdc` varchar(45) DEFAULT NULL,
  `mdt` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `ts_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tsi`
--

DROP TABLE IF EXISTS `tsi`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `tsi` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `dgt` varchar(45) DEFAULT NULL,
  `con` varchar(45) DEFAULT NULL,
  `sqn` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `tsi_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2017-10-12 13:34:30
