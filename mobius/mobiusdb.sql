-- MySQL dump 10.13  Distrib 8.0.12, for Win64 (x86_64)
--
-- Host: localhost    Database: mobiusdb
-- ------------------------------------------------------
-- Server version	8.0.12

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
 SET NAMES utf8 ;
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
 SET character_set_client = utf8mb4 ;
CREATE TABLE `acp` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `pv` longtext NOT NULL,
  `pvs` longtext NOT NULL,
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
 SET character_set_client = utf8mb4 ;
CREATE TABLE `ae` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `apn` varchar(45) NOT NULL,
  `api` varchar(45) NOT NULL,
  `aei` varchar(200) NOT NULL,
  `poa` varchar(200) NOT NULL,
  `or` varchar(45) NOT NULL,
  `rr` varchar(45) NOT NULL,
  `nl` varchar(45) NOT NULL,
  `csz` varchar(45) DEFAULT NULL,
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
 SET character_set_client = utf8mb4 ;
CREATE TABLE `cb` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cst` varchar(45) NOT NULL,
  `csi` varchar(45) NOT NULL,
  `srt` varchar(100) NOT NULL,
  `poa` varchar(200) NOT NULL,
  `nl` varchar(45) NOT NULL,
  `ncp` varchar(45) NOT NULL,
  `srv` varchar(45) DEFAULT NULL,
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
 SET character_set_client = utf8mb4 ;
CREATE TABLE `cin` (
  `pi` varchar(200) NOT NULL,
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cs` int(11) NOT NULL,
  `cr` varchar(45) NOT NULL,
  `cnf` varchar(45) NOT NULL,
  `or` varchar(45) NOT NULL,
  `con` longtext NOT NULL,
  PRIMARY KEY (`ri`,`pi`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  KEY `cin_ri_idx` (`pi`,`ri`,`cs`),
  CONSTRAINT `cin_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cnt`
--

DROP TABLE IF EXISTS `cnt`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
 SET character_set_client = utf8mb4 ;
CREATE TABLE `cnt` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cr` varchar(45) NOT NULL,
  `mni` int(10) unsigned NOT NULL,
  `mbs` int(10) unsigned NOT NULL,
  `mia` int(10) unsigned NOT NULL,
  `cni` int(10) unsigned NOT NULL,
  `cbs` int(10) unsigned NOT NULL,
  `li` varchar(45) NOT NULL,
  `or` varchar(45) NOT NULL,
  `disr` varchar(45) DEFAULT NULL,
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
 SET character_set_client = utf8mb4 ;
CREATE TABLE `csr` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cst` varchar(45) NOT NULL,
  `poa` varchar(200) NOT NULL,
  `cb` varchar(200) NOT NULL,
  `csi` varchar(200) NOT NULL,
  `mei` varchar(45) NOT NULL,
  `tri` varchar(45) NOT NULL,
  `rr` varchar(45) NOT NULL,
  `nl` varchar(45) NOT NULL,
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
 SET character_set_client = utf8mb4 ;
CREATE TABLE `grp` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cr` varchar(45) NOT NULL,
  `mt` varchar(45) NOT NULL,
  `cnm` varchar(45) NOT NULL,
  `mnm` varchar(45) NOT NULL,
  `mid` mediumtext NOT NULL,
  `macp` mediumtext NOT NULL,
  `mtv` varchar(45) NOT NULL,
  `csy` varchar(45) NOT NULL,
  `gn` varchar(45) NOT NULL,
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
 SET character_set_client = utf8mb4 ;
CREATE TABLE `lcp` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `los` varchar(45) NOT NULL,
  `lou` varchar(45) NOT NULL,
  `lot` varchar(45) NOT NULL,
  `lor` varchar(45) NOT NULL,
  `loi` varchar(45) NOT NULL,
  `lon` varchar(45) NOT NULL,
  `lost` varchar(45) NOT NULL,
  `cr` varchar(45) NOT NULL,
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
 SET character_set_client = utf8mb4 ;
CREATE TABLE `lookup` (
  `pi` varchar(200) NOT NULL,
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `ty` int(11) unsigned NOT NULL,
  `ct` varchar(15) NOT NULL,
  `st` int(11) unsigned NOT NULL,
  `rn` varchar(45) NOT NULL,
  `lt` varchar(45) NOT NULL,
  `et` varchar(45) NOT NULL,
  `acpi` varchar(200) NOT NULL,
  `lbl` varchar(200) NOT NULL,
  `at` varchar(45) NOT NULL,
  `aa` varchar(45) NOT NULL,
  `sri` varchar(45) NOT NULL,
  `spi` varchar(45) NOT NULL,
  PRIMARY KEY (`pi`,`ri`,`ty`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  KEY `idx_lookup_ty` (`ty`) USING BTREE,
  KEY `idx_lookup_pi` (`pi`,`st`,`ct`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mgo`
--

DROP TABLE IF EXISTS `mgo`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
 SET character_set_client = utf8mb4 ;
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
  `cr` varchar(45) DEFAULT NULL,
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
 SET character_set_client = utf8mb4 ;
CREATE TABLE `mms` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `sid` varchar(45) DEFAULT NULL,
  `soid` varchar(45) DEFAULT NULL,
  `stid` varchar(45) DEFAULT NULL,
  `asd` varchar(45) DEFAULT NULL,
  `osd` varchar(45) DEFAULT NULL,
  `sst` varchar(45) DEFAULT NULL,
  `cr` varchar(45) DEFAULT NULL,
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
 SET character_set_client = utf8mb4 ;
CREATE TABLE `nod` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `ni` varchar(45) NOT NULL,
  `hcl` varchar(45) DEFAULT NULL,
  `mgca` varchar(45) DEFAULT NULL,
  `cr` varchar(45) DEFAULT NULL,
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
 SET character_set_client = utf8mb4 ;
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
  `cr` varchar(45) DEFAULT NULL,
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
 SET character_set_client = utf8mb4 ;
CREATE TABLE `smd` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cr` varchar(45) DEFAULT NULL,
  `dsp` longtext,
  `or` mediumtext,
  `soe` varchar(200) DEFAULT NULL,
  `rels` varchar(400) DEFAULT NULL,
  `dcrp` longtext,
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
 SET character_set_client = utf8mb4 ;
CREATE TABLE `sri` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `sri` varchar(45) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  PRIMARY KEY (`ri`,`sri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  KEY `idx_sri_sri` (`sri`),
  CONSTRAINT `sri_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sub`
--

DROP TABLE IF EXISTS `sub`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
 SET character_set_client = utf8mb4 ;
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
-- Table structure for table `tm`
--

DROP TABLE IF EXISTS `tm`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
 SET character_set_client = utf8mb4 ;
CREATE TABLE `tm` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `tltm` varchar(45) DEFAULT NULL,
  `text` varchar(45) DEFAULT NULL,
  `tct` varchar(45) DEFAULT NULL,
  `tept` varchar(45) DEFAULT NULL,
  `tmd` varchar(45) DEFAULT NULL,
  `tltp` varchar(45) DEFAULT NULL,
  `tctl` varchar(45) DEFAULT NULL,
  `tst` varchar(45) DEFAULT NULL,
  `tmr` varchar(45) DEFAULT NULL,
  `tmh` varchar(45) DEFAULT NULL,
  `rqps` mediumtext,
  `rsps` mediumtext,
  `cr` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `tm_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tr`
--

DROP TABLE IF EXISTS `tr`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
 SET character_set_client = utf8mb4 ;
CREATE TABLE `tr` (
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cr` varchar(45) DEFAULT NULL,
  `tid` varchar(45) NOT NULL,
  `tctl` varchar(45) DEFAULT NULL,
  `tst` varchar(45) DEFAULT NULL,
  `tltm` varchar(45) DEFAULT NULL,
  `text` varchar(45) DEFAULT NULL,
  `tct` varchar(45) DEFAULT NULL,
  `tltp` varchar(45) DEFAULT NULL,
  `trqp` mediumtext NOT NULL,
  `trsp` mediumtext,
  PRIMARY KEY (`ri`),
  UNIQUE KEY `ri_UNIQUE` (`ri`),
  CONSTRAINT `tr_ri` FOREIGN KEY (`ri`) REFERENCES `lookup` (`ri`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ts`
--

DROP TABLE IF EXISTS `ts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
 SET character_set_client = utf8mb4 ;
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
 SET character_set_client = utf8mb4 ;
CREATE TABLE `tsi` (
  `pi` varchar(200) NOT NULL,
  `ri` varchar(200) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `cs` int(11) DEFAULT NULL,
  `dgt` varchar(45) DEFAULT NULL,
  `con` varchar(45) DEFAULT NULL,
  `sqn` varchar(45) DEFAULT NULL,
  `cr` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`pi`,`ri`),
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

-- Dump completed on 2018-09-11 18:51:46
